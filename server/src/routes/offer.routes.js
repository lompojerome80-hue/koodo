import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";
import { notifyUser } from "../notify.js";

const router = Router();

// Create offer (offline-queue compat): accept either POST / with auth, or bulk sync
router.post("/", authRequired, (req, res) => {
  const { cropId, quantity, unitPrice, locationLat, locationLng, image } = req.body || {};
  if (!cropId || !Number(quantity) || !Number(unitPrice)) {
    return res.status(400).json({ error: "culture, quantité et prix requis" });
  }
  const id = nanoid();
  db.prepare(
    `INSERT INTO offers (id, user_id, crop_id, quantity, unit_price, location_lat, location_lng, image)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, req.user.sub, cropId, Number(quantity), Number(unitPrice), Number(locationLat) || null, Number(locationLng) || null, typeof image === "string" && image ? image : null);
  res.status(201).json({ offer: getOffer(id) });
});

// Bulk upsert for offline sync
router.post("/sync", authRequired, (req, res) => {
  const { offers } = req.body || {};
  if (!Array.isArray(offers) || !offers.length) return res.json({ synced: 0 });
  const insert = db.prepare(
    `INSERT INTO offers (id, user_id, crop_id, quantity, unit_price, status, location_lat, location_lng, image, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`
  );
  let count = 0;
  for (const o of offers) {
    const info = insert.run(o.id || nanoid(), req.user.sub, o.cropId, Number(o.quantity), Number(o.unitPrice), "open",
      Number(o.lat) || null, Number(o.lng) || null, typeof o.image === "string" && o.image ? o.image : null,
      o.createdAt || new Date().toISOString());
    if (info.changes) count++;
  }
  res.json({ synced: count });
});

// List offers — visible market (w/ seller) or own offers (?mine=1)
router.get("/", authRequired, (req, res) => {
  const mine = req.query.mine === "1";
  if (mine) {
    const rows = db.prepare(
      `SELECT o.id, o.crop_id, o.quantity, o.unit_price, o.status, o.created_at, o.location_lat, o.location_lng, o.image,
              c.name crop_name, c.emoji
       FROM offers o JOIN crops c ON c.id=o.crop_id
       WHERE o.user_id=?
       ORDER BY datetime(o.created_at) DESC`
    ).all(req.user.sub);
    return res.json(rows);
  }
  const rows = db.prepare(
    `SELECT o.id, o.crop_id, o.quantity, o.unit_price, o.status, o.created_at, o.location_lat, o.location_lng, o.image,
            c.name crop_name, c.emoji, u.id seller_id, u.full_name seller, u.village, u.region
     FROM offers o JOIN crops c ON c.id=o.crop_id JOIN users u ON u.id=o.user_id
     WHERE o.status='open'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=o.user_id)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocked_id=? AND b.blocker_id=o.user_id)
     ORDER BY datetime(o.created_at) DESC`
  ).all(req.user.sub, req.user.sub);
  res.json(rows);
});

// Un acheteur acquiert qtyKg d'une annonce : stock décrémenté,
// annonce clôturée si stock épuisé.
export function consumeOfferStock(offerId, qtyKg) {
  const qty = Number(qtyKg);
  if (!offerId || !Number.isFinite(qty) || qty <= 0) return { remaining: null, status: null };
  const offer = db.prepare("SELECT * FROM offers WHERE id=? AND status='open'").get(offerId);
  if (!offer) return { remaining: null, status: null };
  const remaining = Math.max(0, offer.quantity - qty);
  const status = remaining <= 0 ? "sold" : "open";
  db.prepare("UPDATE offers SET quantity=?, status=?, updated_at=datetime('now') WHERE id=?").run(remaining, status, offerId);
  return { remaining, status };
}

router.post("/consume", authRequired, (req, res) => {
  const { offerId, qtyKg } = req.body || {};
  const qty = Number(qtyKg);
  if (!offerId || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: "offerId et qtyKg requis" });
  }
  const offer = db.prepare("SELECT * FROM offers WHERE id=? AND status='open'").get(offerId);
  if (!offer) return res.status(404).json({ error: "Annonce introuvable ou déjà clôturée" });
  if (offer.user_id === req.user.sub) return res.status(403).json({ error: "Impossible d'acheter sa propre annonce" });
  if (qty > offer.quantity) return res.status(400).json({ error: `Quantité disponible : ${offer.quantity} kg` });
  const { remaining, status } = consumeOfferStock(offerId, qty);
  res.json({ ok: true, remaining, status });
});

// Update offer status (producer marks sold/cancelled)
router.patch("/:id", authRequired, (req, res) => {
  const { status } = req.body || {};
  if (!["open", "sold", "cancelled"].includes(status)) return res.status(400).json({ error: "statut invalide" });
  const offer = db.prepare("SELECT * FROM offers WHERE id=?").get(req.params.id);
  if (!offer) return res.status(404).json({ error: "annonce introuvable" });
  if (offer.user_id !== req.user.sub) return res.status(403).json({ error: "non autorisé" });
  db.prepare("UPDATE offers SET status=?, updated_at=datetime('now') WHERE id=?").run(status, req.params.id);
  res.json({ offer: getOffer(req.params.id) });
});

function getOffer(id) {
  return db.prepare(
    `SELECT o.*, c.name crop_name, c.emoji, u.full_name seller, u.village FROM offers o
     JOIN crops c ON c.id=o.crop_id JOIN users u ON u.id=o.user_id WHERE o.id=?`
  ).get(id);
}

// Un acheteur signale une annonce (contenu abusif, fraude, hors-liste…).
// L'annonce reste visible tant que l'admin n'a pas statué (modération UGC).
router.post("/:id/report", authRequired, (req, res) => {
  const offer = db.prepare("SELECT id, user_id FROM offers WHERE id=? AND status='open'").get(req.params.id);
  if (!offer) return res.status(404).json({ error: "Annonce introuvable ou clôturée" });
  if (offer.user_id === req.user.sub) return res.status(403).json({ error: "Impossible de signaler sa propre annonce" });
  const reason = String(req.body?.reason || "").trim().slice(0, 200);
  const note = String(req.body?.note || "").trim().slice(0, 500);
  if (!reason) return res.status(400).json({ error: "Raison du signalement requise" });
  const existing = db.prepare("SELECT id FROM reports WHERE offer_id=? AND reporter_id=?").get(offer.id, req.user.sub);
  if (existing) return res.status(409).json({ error: "Annonce déjà signalée par toi — l'équipe s'en occupe" });
  db.prepare(
    `INSERT INTO reports (id, offer_id, reporter_id, reason, note) VALUES (?,?,?,?,?)`
  ).run(nanoid(), offer.id, req.user.sub, reason, note || null);
  // Préviens les administrateurs pour une modération rapide.
  const reporter = db.prepare("SELECT full_name FROM users WHERE id=?").get(req.user.sub);
  const admins = db.prepare("SELECT id FROM users WHERE role='admin' AND anonymized=0").all();
  for (const a of admins) {
    notifyUser(a.id, {
      kind: "report",
      title: "Nouveau signalement d'annonce",
      body: `${reporter?.full_name || "Un membre"} a signalé une annonce : « ${reason} »`,
      offer_id: offer.id,
    });
  }
  res.status(201).json({ ok: true });
});

export default router;
