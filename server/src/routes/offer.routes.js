import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";

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
            c.name crop_name, c.emoji, u.full_name seller, u.village, u.region
     FROM offers o JOIN crops c ON c.id=o.crop_id JOIN users u ON u.id=o.user_id
     WHERE o.status='open'
     ORDER BY datetime(o.created_at) DESC`
  ).all();
  res.json(rows);
});

// Un acheteur acquiert qtyKg d'une annonce : stock décrémenté,
// annonce clôturée si stock épuisé.
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
  const remaining = Math.max(0, offer.quantity - qty);
  const status = remaining <= 0 ? "sold" : "open";
  db.prepare("UPDATE offers SET quantity=?, status=?, updated_at=datetime('now') WHERE id=?").run(remaining, status, offerId);
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

export default router;
