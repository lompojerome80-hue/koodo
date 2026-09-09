import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";
import { notifyUser } from "../notify.js";
import { pushTo } from "../realtime.js";
import { releaseEscrow } from "./pay.routes.js";

const router = Router();

const COMMISSION_RATE = 0.1;

const today = () =>
  new Date().toLocaleDateString("en-CA").replace(/-/g, "-") || new Date().toISOString().slice(0, 10);

const code = () => String(Math.floor(100000 + Math.random() * 900000));

function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

const courierRow = (d, myId) => ({
  id: d.id,
  tx_ref: d.tx_ref,
  title: d.title,
  package: d.package,
  seller_id: d.seller_id,
  seller_name: d.seller_name,
  courier_id: d.courier_id,
  courier_name: d.courier_name,
  courier_photo: d.courier_selfie ?? undefined,
  courier_transport: d.courier_transport ?? undefined,
  courier_locality: d.courier_locality ?? undefined,
  courier_verified: d.courier_doc_status === "verified" ? 1 : 0,
  seller_label: d.seller_label,
  seller_lat: d.seller_lat,
  seller_lng: d.seller_lng,
  buyer_label: d.buyer_label,
  buyer_lat: d.buyer_lat,
  buyer_lng: d.buyer_lng,
  buyer_phone: d.buyer_phone,
  price_fee: d.price_fee,
  status: d.status,
  pickup_code: myId === d.seller_id ? d.pickup_code : undefined,
  delivery_code: myId === d.buyer_id || myId === d.seller_id ? d.delivery_code : undefined,
  distanceKm: d.seller_lat != null ? haversineKm(d.me_lat, d.me_lng, d.seller_lat, d.seller_lng) : null,
  created_at: d.created_at,
  accepted_at: d.accepted_at,
  picked_at: d.picked_at,
  delivered_at: d.delivered_at,
});

const SELECT_JOINED = `
  SELECT d.*,
    s.full_name AS seller_name,
    c.full_name AS courier_name,
    c.selfie AS courier_selfie,
    c.transport AS courier_transport,
    c.locality AS courier_locality,
    c.doc_status AS courier_doc_status,
    (SELECT u.id FROM users u WHERE u.phone = d.buyer_phone LIMIT 1) AS buyer_id
  FROM deliveries d
  LEFT JOIN users s ON s.id = d.seller_id
  LEFT JOIN users c ON c.id = d.courier_id
`;

function blockedFor(id) {
  return db.prepare("SELECT blocked, blocked_reason FROM users WHERE id = ?").get(id);
}

function courierDossierOk(id) {
  const u = db.prepare("SELECT locality, transport, selfie, id_front, id_back FROM users WHERE id = ?").get(id);
  return !!u && [u.locality, u.transport, u.selfie, u.id_front, u.id_back].every(Boolean);
}

function assertNotBlockedCourier(id) {
  const u = blockedFor(id);
  if (u?.blocked) {
    const err = new Error(u.blocked_reason || "Compte bloqué : dû de livreur non réglé");
    err.status = 403;
    throw err;
  }
  if (!courierDossierOk(id)) {
    const err = new Error("Dossier incomplet — ajoute ta localité, ton moyen de déplacement, ta photo et ta pièce d'identité (recto + verso) dans Mon dossier.");
    err.status = 403;
    throw err;
  }
}

function dailyUnpaid() {
  // Dû non réglé dont l'échéance est passée (hier et avant) → bloque le compte.
  return db
    .prepare(
      `SELECT courier_id, SUM(amount) total, COUNT(*) n FROM courier_dues
       WHERE paid = 0 AND due_date < date('now','localtime')
       GROUP BY courier_id`
    )
    .all();
}

export function enforceDuesBlock() {
  for (const row of dailyUnpaid()) {
    db.prepare("UPDATE users SET blocked = 1, blocked_reason = ? WHERE id = ? AND role = 'courier'").run(
      `Dû non réglé de ${row.total} F depuis hier — règle ton dû pour débloquer`,
      row.courier_id
    );
  }
}

export function startDuesScheduler() {
  let lastRun = today();
  const tick = () => {
    const t = today();
    if (t !== lastRun) {
      lastRun = t;
      enforceDuesBlock();
      console.log("[delivery] check dû livreur à minuit");
    }
  };
  tick();
  setInterval(tick, 60_000);
}

function error(res, err) {
  if (err.status === 403) return res.status(403).json({ error: err.message });
  if (err.status === 404) return res.status(404).json({ error: err.message });
  if (err.status === 409) return res.status(409).json({ error: err.message });
  res.status(400).json({ error: err.message });
}

// Notification "sticky" : le destinataire la voit dans son centre de notifications
// à sa prochaine connexion (pas besoin qu'il soit en ligne à l'événement).
function buyerIdOf(d) {
  const row = d.buyer_phone
    ? db.prepare("SELECT id FROM users WHERE phone = ? LIMIT 1").get(d.buyer_phone)
    : null;
  return row ? row.id : null;
}

// Un vendeur crée une course : un livreur proche viendra récupérer puis livrer.
router.post("/", authRequired, (req, res) => {
  try {
    const { title, package: pkg, buyer_label, buyer_lat, buyer_lng, buyer_phone, price_fee, tx_ref } = req.body || {};
    if (!title || !buyer_label || price_fee == null) {
      return res.status(400).json({ error: "Titre, destination et prix de la course requis" });
    }
    if (Number(price_fee) < 100 || Number(price_fee) > 100000) {
      return res.status(400).json({ error: "Prix de la course entre 100 et 100 000 F" });
    }
    const id = nanoid();
    db.prepare(
      `INSERT INTO deliveries
        (id, tx_ref, title, package, seller_id, seller_lat, seller_lng, seller_label,
         buyer_lat, buyer_lng, buyer_label, buyer_phone, price_fee, pickup_code, delivery_code)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      tx_ref || null,
      String(title),
      pkg ? String(pkg) : null,
      req.user.sub,
      req.body.seller_lat ?? null,
      req.body.seller_lng ?? null,
      req.body.seller_label ?? req.user?.name ?? null,
      buyer_lat ?? null,
      buyer_lng ?? null,
      String(buyer_label),
      buyer_phone ? String(buyer_phone).replace(/[\s\-().]/g, "") : null,
      Number(price_fee),
      code(),
      code()
    );
    const row = db.prepare(
      `${SELECT_JOINED} WHERE d.id = ?`
    ).get(id);
    res.status(201).json({ delivery: courierRow({ ...row, me_lat: req.body.seller_lat, me_lng: req.body.seller_lng }, req.user.sub) });
  } catch (err) {
    error(res, err);
  }
});

// Courses ouvertes proches (le livreur cherche le travail près de chez lui).
router.get("/open", authRequired, (req, res) => {
  const me = db.prepare("SELECT id, region, village, role FROM users WHERE id = ?").get(req.user.sub);
  const lat = parseFloat(req.query.lat ?? "");
  const lng = parseFloat(req.query.lng ?? "");
  const me_lat = Number.isFinite(lat) ? lat : null;
  const me_lng = Number.isFinite(lng) ? lng : null;
  const rows = db
    .prepare(`${SELECT_JOINED} WHERE d.status = 'open' AND d.seller_id != ? ORDER BY d.created_at DESC`)
    .all(req.user.sub);
  res.json({
    deliveries: rows.map((d) =>
      courierRow({ ...d, me_lat, me_lng }, req.user.sub)
    ),
  });
});

// Grille du compte connecté : courses créées (vendeur) ou acceptées (livreur).
router.get("/mine", authRequired, (req, res) => {
  const rows = db
    .prepare(`${SELECT_JOINED} WHERE d.seller_id = ? OR d.courier_id = ? ORDER BY d.created_at DESC`)
    .all(req.user.sub, req.user.sub);
  res.json({ deliveries: rows.map((d) => courierRow({ ...d, me_lat: null, me_lng: null }, req.user.sub)) });
});

// L'acheteur dont la commande est acheminée voit le code à donner au livreur.
router.get("/for-me", authRequired, (req, res) => {
  const u = db.prepare("SELECT phone FROM users WHERE id = ?").get(req.user.sub);
  const row = db
    .prepare(`${SELECT_JOINED} WHERE d.buyer_phone = ? AND d.status IN ('accepted','picked_up') ORDER BY d.created_at DESC LIMIT 1`)
    .get(u.phone);
  if (row && row.buyer_id && row.buyer_id === req.user.sub) {
    return res.json({ delivery: courierRow({ ...row, me_lat: null, me_lng: null }, req.user.sub) });
  }
  res.json({ delivery: null });
});

// Grille des dus : jours détaillés, total, éventuel paiement en attente d'admin.
function duesOf(courierId) {
  const u = blockedFor(courierId);
  const days = db
    .prepare(
      `SELECT due_date, SUM(amount) amount, SUM(CASE WHEN paid = 1 THEN 1 ELSE 0 END) paid_rows,
              SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END) unpaid
       FROM courier_dues WHERE courier_id = ?
       GROUP BY due_date ORDER BY due_date DESC`
    )
    .all(courierId)
    .map((r) => ({
      due_date: r.due_date,
      amount: r.amount,
      paid: r.paid_rows > 0 && r.unpaid === 0 ? 1 : 0,
      unpaid: r.unpaid,
    }));
  const totalUnpaid = days.reduce((s, d) => s + d.unpaid, 0);
  const dueToday = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) s FROM courier_dues
       WHERE courier_id = ? AND paid = 0 AND due_date = date('now','localtime')`
    )
    .get(courierId).s;
  const pending = db
    .prepare(
      `SELECT id, amount, receipt, created_at FROM payments
       WHERE courier_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`
    )
    .get(courierId);
  return {
    blocked: !!u?.blocked,
    blockedReason: u?.blocked_reason || null,
    dueToday,
    totalUnpaid,
    days,
    pendingPayment: pending
      ? { id: pending.id, amount: pending.amount, createdAt: pending.created_at, hasReceipt: !!pending.receipt }
      : null,
  };
}

router.get("/dues", authRequired, (req, res) => {
  res.json(duesOf(req.user.sub));
});

// Règlement du dû du jour. La capture d'écran du paiement est OBLIGATOIRE :
// c'est elle qui atteste le règlement auprès de l'admin. Le règlement passe en
// « pending », le compte reste bloqué, et l'admin le confirme dans la console
// (le dû repasse alors à zéro et le compte est débloqué).
router.post("/dues/settle", authRequired, (req, res) => {
  const u = blockedFor(req.user.sub);
  if (u?.role && u.role !== "courier") {
    return res.status(403).json({ error: "Réservé aux livreurs" });
  }
  const receipt =
    typeof req.body?.receipt_image === "string" && req.body.receipt_image.length > 100
      ? req.body.receipt_image
      : null;
  if (!receipt) {
    return res.status(400).json({ error: "Capture d'écran obligatoire — joins la preuve de ton règlement" });
  }
  const dues = duesOf(req.user.sub);
  if (dues.pendingPayment) {
    return res.status(409).json({ error: "Un règlement est déjà en attente de vérification par l'admin" });
  }
  const pId = nanoid();
  db.prepare(
    "INSERT INTO payments (id, courier_id, amount, receipt, status, created_at) VALUES (?,?,?,?, 'pending', datetime('now','localtime'))"
  ).run(pId, req.user.sub, dues.totalUnpaid, receipt);
  db.prepare("UPDATE users SET blocked = 1, blocked_reason = ? WHERE id = ?").run(
    "Paiement envoyé — en attente de vérification par l'admin",
    req.user.sub
  );
  res.json({ ok: true, pending: true, ...duesOf(req.user.sub) });
});

// Le livreur accepte la course → le vendeur lui donne le code de récupération.
router.post("/:id/accept", authRequired, (req, res) => {
  try {
    const d = db.prepare("SELECT * FROM deliveries WHERE id = ?").get(req.params.id);
    if (!d) throw Object.assign(new Error("Course introuvable"), { status: 404 });
    if (d.status !== "open") throw Object.assign(new Error("Cette course n'est plus disponible"), { status: 409 });
    assertNotBlockedCourier(req.user.sub);
    db.prepare("UPDATE deliveries SET courier_id = ?, status = 'accepted', accepted_at = datetime('now','localtime') WHERE id = ?")
      .run(req.user.sub, d.id);
    const courier = db.prepare("SELECT full_name, selfie AS photo FROM users WHERE id = ?").get(req.user.sub);
    const buyerId = buyerIdOf(d);
    if (d.seller_id && d.seller_id !== req.user.sub) {
      notifyUser(d.seller_id, {
        kind: "delivery_accepted",
        title: "Livreur trouvé",
        body: `${courier.full_name} a accepté « ${d.title} ». Il te donnera le code de récupération à l'enlèvement.`,
        actor_name: courier.full_name,
        actor_photo: courier.photo,
        delivery_id: d.id,
      });
    }
    if (buyerId && buyerId !== req.user.sub && buyerId !== d.seller_id) {
      notifyUser(buyerId, {
        kind: "delivery_accepted",
        title: "Ta course a un livreur",
        body: `${courier.full_name} apporte « ${d.title} ». C'est cette personne qui te remettra ton colis.`,
        actor_name: courier.full_name,
        actor_photo: courier.photo,
        delivery_id: d.id,
      });
    }
    const row = db.prepare(`${SELECT_JOINED} WHERE d.id = ?`).get(d.id);
    res.json({ delivery: courierRow({ ...row, me_lat: null, me_lng: null }, req.user.sub) });
  } catch (err) {
    error(res, err);
  }
});

// Preuve de récupération du colis : le vendeur donne son code au livreur.
router.post("/:id/pickup", authRequired, (req, res) => {
  try {
    const d = db.prepare("SELECT * FROM deliveries WHERE id = ?").get(req.params.id);
    if (!d) throw Object.assign(new Error("Course introuvable"), { status: 404 });
    if (d.courier_id !== req.user.sub) throw Object.assign(new Error("Cette course ne t'est pas attribuée"), { status: 403 });
    if (d.status !== "accepted") throw Object.assign(new Error("La course doit d'abord être acceptée"), { status: 409 });
    if (String(req.body?.pickupCode || "").trim() !== d.pickup_code) {
      throw Object.assign(new Error("Code de récupération invalide — vérifie auprès du vendeur"), { status: 400 });
    }
    db.prepare("UPDATE deliveries SET status = 'picked_up', picked_at = datetime('now','localtime') WHERE id = ?").run(d.id);
    const courier = db.prepare("SELECT full_name, selfie AS photo FROM users WHERE id = ?").get(req.user.sub);
    const buyerId = buyerIdOf(d);
    if (buyerId && buyerId !== req.user.sub && buyerId !== d.seller_id) {
      notifyUser(buyerId, {
        kind: "delivery_picked",
        title: "Colis récupéré, en route",
        body: `${courier.full_name} a récupéré « ${d.title} » et se dirige vers toi.`,
        actor_name: courier.full_name,
        actor_photo: courier.photo,
        delivery_id: d.id,
      });
    }
    const row = db.prepare(`${SELECT_JOINED} WHERE d.id = ?`).get(d.id);
    res.json({ delivery: courierRow({ ...row, me_lat: null, me_lng: null }, req.user.sub) });
  } catch (err) {
    error(res, err);
  }
});

// Livraison remise : l'acheteur donne son code → commission 10 % du prix de course.
router.post("/:id/complete", authRequired, (req, res) => {
  try {
    const d = db.prepare("SELECT * FROM deliveries WHERE id = ?").get(req.params.id);
    if (!d) throw Object.assign(new Error("Course introuvable"), { status: 404 });
    if (d.courier_id !== req.user.sub) throw Object.assign(new Error("Cette course ne t'est pas attribuée"), { status: 403 });
    if (d.status !== "picked_up") throw Object.assign(new Error("La course doit avoir été récupérée"), { status: 409 });
    if (String(req.body?.deliveryCode || "").trim() !== d.delivery_code) {
      throw Object.assign(new Error("Code de livraison invalide — vérifie auprès de l'acheteur"), { status: 400 });
    }
    const commission = Math.round(Number(d.price_fee) * COMMISSION_RATE);
    db.transaction(() => {
      db.prepare(
        `UPDATE deliveries SET status = 'done', delivered_at = datetime('now','localtime') WHERE id = ?`
      ).run(d.id);
      db.prepare(
        `INSERT INTO courier_dues (courier_id, due_date, amount) VALUES (?, date('now','localtime'), ?)`
      ).run(req.user.sub, commission);
    })();
    const courier = db.prepare("SELECT full_name, selfie AS photo FROM users WHERE id = ?").get(req.user.sub);
    if (d.seller_id && d.seller_id !== req.user.sub) {
      notifyUser(d.seller_id, {
        kind: "delivery_done",
        title: "Course livrée",
        body: `${courier.full_name} a remis « ${d.title} » à l'acheteur. Merci pour ta course.`,
        actor_name: courier.full_name,
        actor_photo: courier.photo,
        delivery_id: d.id,
      });
    }
    // Libération AUTOMATIQUE du paiement de l'acheteur : la remise du colis
    // (scan du QR ou code client validé par le livreur) vaut preuve de livraison.
    // Si un litige est ouvert, les fonds restent volontairement bloqués.
    const rel = d.tx_ref ? releaseEscrow(d.tx_ref) : { released: false, reason: "none", sellers: [] };
    if (rel.released) {
      for (const sid of rel.sellers) {
        notifyUser(sid, {
          kind: "payment_released",
          title: "Paiement libéré 💰",
          body: `Le client a reçu « ${d.title} » (livré par ${courier.full_name}) — ton paiement est libéré.`,
          actor_name: courier.full_name,
          actor_photo: courier.photo,
          delivery_id: d.id,
        });
      }
      const buyerId = buyerIdOf(d);
      if (buyerId && buyerId !== req.user.sub) {
        notifyUser(buyerId, {
          kind: "payment_released",
          title: "Paiement libéré au vendeur ✅",
          body: `« ${d.title} » a été remis — le vendeur vient d'être payé. Merci pour ta confiance !`,
          delivery_id: d.id,
        });
      }
    }
    const row = db.prepare(`${SELECT_JOINED} WHERE d.id = ?`).get(d.id);
    const dues = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) s FROM courier_dues
         WHERE courier_id = ? AND due_date = date('now','localtime')`
      )
      .get(req.user.sub).s;
    res.json({ delivery: courierRow({ ...row, me_lat: null, me_lng: null }, req.user.sub), commission, dueToday: dues });
  } catch (err) {
    error(res, err);
  }
});

router.post("/:id/cancel", authRequired, (req, res) => {
  try {
    const d = db.prepare("SELECT * FROM deliveries WHERE id = ?").get(req.params.id);
    if (!d) throw Object.assign(new Error("Course introuvable"), { status: 404 });
    if (d.seller_id !== req.user.sub) throw Object.assign(new Error("Seul le vendeur peut annuler"), { status: 403 });
    if (!["open", "accepted"].includes(d.status)) throw Object.assign(new Error("Impossible d'annuler cette course"), { status: 409 });
    db.prepare("UPDATE deliveries SET status = 'cancelled' WHERE id = ?").run(d.id);
    res.json({ ok: true });
  } catch (err) {
    error(res, err);
  }
});

// ============================================================
// Confiage direct : le vendeur choisit un livreur proche pour une commande.
// ============================================================

// Livreurs missionnables (dossier complet, compte non bloqué), triés par
// proximité de zone avec le vendeur.
router.get("/couriers", authRequired, (req, res) => {
  const seller = db.prepare("SELECT region, village, locality FROM users WHERE id = ?").get(req.user.sub);
  const tokens = new Set(
    [seller?.locality, seller?.village, seller?.region]
      .filter(Boolean).join(" ").toLowerCase()
      .split(/[\s,.-]+/).filter((w) => w.length > 2)
  );
  const rows = db.prepare(
    `SELECT id, full_name, phone, locality, region, village, transport, selfie
     FROM users WHERE role = 'courier' AND blocked = 0 ORDER BY full_name`
  ).all();
  const couriers = rows
    .filter((c) => courierDossierOk(c.id))
    .map((c) => {
      const text = [c.locality, c.village, c.region].filter(Boolean).join(" ").toLowerCase();
      const score = [...tokens].filter((w) => text.includes(w)).length;
      return {
        id: c.id,
        name: c.full_name,
        phone: c.phone,
        locality: c.locality || null,
        transport: c.transport || null,
        selfie: c.selfie || null,
        proche: score > 0,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  res.json({ couriers });
});

// Le vendeur confie directement une commande (client_ref) à un livreur qu'il
// a choisi à proximité. La course naît déjà « acceptée » par ce livreur.
router.post("/assign", authRequired, (req, res) => {
  try {
    const { txId, courierId, priceFee, seller_lat, seller_lng, seller_label } = req.body || {};
    if (!txId || !courierId) throw Object.assign(new Error("Commande et livreur requis"), { status: 400 });
    const fee = Number(priceFee);
    if (!(fee >= 100 && fee <= 100000)) {
      throw Object.assign(new Error("Prix de la course entre 100 et 100 000 F"), { status: 400 });
    }
    const rows = db.prepare(
      `SELECT t.*, c.name crop_name, c.emoji crop_emoji
       FROM transactions t JOIN offers o ON o.id = t.offer_id
       JOIN crops c ON c.id = o.crop_id
       WHERE t.client_ref = ? AND t.status = 'paid'`
    ).all(txId);
    if (!rows.length) throw Object.assign(new Error("Commande introuvable"), { status: 404 });
    const mine = rows.filter((r) =>
      db.prepare("SELECT user_id FROM offers WHERE id = ?").get(r.offer_id)?.user_id === req.user.sub
    );
    if (mine.length !== rows.length) {
      throw Object.assign(new Error("Cette commande ne t'appartient pas"), { status: 403 });
    }
    const existing = db.prepare(
      "SELECT id FROM deliveries WHERE tx_ref = ? AND status != 'cancelled' LIMIT 1"
    ).get(txId);
    if (existing) throw Object.assign(new Error("Cette commande est déjà confiée à un livreur"), { status: 409 });
    const courier = db.prepare("SELECT id, full_name FROM users WHERE id = ? AND role = 'courier'").get(courierId);
    if (!courier) throw Object.assign(new Error("Livreur introuvable"), { status: 404 });
    assertNotBlockedCourier(courierId);

    const seller = db.prepare("SELECT full_name, phone, region, village FROM users WHERE id = ?").get(req.user.sub);
    const buyer = db.prepare("SELECT full_name, phone FROM users WHERE id = ?").get(rows[0].buyer_id);
    const label = rows.map((r) => r.delivery_label).find(Boolean) || null;
    const lat = rows.map((r) => r.location_lat).find((v) => v != null) ?? null;
    const lng = rows.map((r) => r.location_lng).find((v) => v != null) ?? null;
    const note = rows.map((r) => r.delivery_note).find(Boolean) || null;
    const title = `Commande · ${`${rows[0].crop_emoji || ""} ${rows[0].crop_name}`.trim()}`;

    const pickupCode = code();
    const deliveryCode = code();
    const id = nanoid();
    db.prepare(
      `INSERT INTO deliveries
        (id, tx_ref, title, package, seller_id, courier_id, seller_lat, seller_lng, seller_label,
         buyer_lat, buyer_lng, buyer_label, buyer_phone, price_fee, status, pickup_code, delivery_code, accepted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'accepted',?,?, datetime('now','localtime'))`
    ).run(
      id, txId, title, note, req.user.sub, courierId,
      Number(seller_lat) || null, Number(seller_lng) || null,
      String(seller_label || seller?.village || seller?.full_name || ""),
      lat, lng, String(label || "remis à l'acheteur"),
      buyer?.phone ? buyer.phone.replace(/[\s\-().]/g, "") : null,
      fee, pickupCode, deliveryCode
    );

    const sellerPlace = seller_label || seller?.village || seller?.full_name || "le vendeur";
    notifyUser(courierId, {
      kind: "delivery_assigned",
      title: "Une course t'a été confiée 🙌",
      body: `${seller?.full_name || "Un vendeur"} te confie « ${title} ». Récupère le colis chez ${sellerPlace}. Code de récupération : ${pickupCode}.`,
      actor_name: seller?.full_name,
      delivery_id: id,
    });
    if (rows[0].buyer_id && rows[0].buyer_id !== req.user.sub) {
      notifyUser(rows[0].buyer_id, {
        kind: "delivery_found",
        title: "Un livreur prend ta commande",
        body: `${courier.full_name} apporte « ${title} » — il récupère le colis chez le vendeur puis te le remet.`,
        actor_name: courier.full_name,
        delivery_id: id,
      });
    }
    pushTo(courierId, { type: "delivery", deliveryId: id });
    pushTo(rows[0].buyer_id, { type: "delivery", deliveryId: id });

    const row = db.prepare(`${SELECT_JOINED} WHERE d.id = ?`).get(id);
    res.status(201).json({
      delivery: courierRow({ ...row, me_lat: seller_lat ?? null, me_lng: seller_lng ?? null }, req.user.sub),
    });
  } catch (err) {
    error(res, err);
  }
});

// ============================================================
// Démo : simule la fin de journée (dû impayé → blocage auto)
// Réservé au mode démo, inoffensif en production (404).
// ============================================================
router.post("/__debug/force-due-block", authRequired, (req, res) => {
  if (req.app.get("env") === "production") return res.status(404).json({ error: "santé" });
  const u = db.prepare("SELECT role FROM users WHERE id = ?").get(req.user.sub);
  if (u?.role !== "courier") return res.status(403).json({ error: "Réservé aux livreurs (démo)" });
  const due = db
    .prepare("SELECT COALESCE(SUM(amount),0) s FROM courier_dues WHERE courier_id=? AND due_date = date('now','localtime') AND paid=0")
    .get(req.user.sub).s;
  db.prepare("INSERT INTO courier_dues (courier_id, due_date, amount) VALUES (?, date('now','localtime','-1 day'), ?)").run(req.user.sub, due || 200);
  enforceDuesBlock();
  res.json({ ok: true, blocked: !!db.prepare("SELECT blocked FROM users WHERE id=?").get(req.user.sub).blocked });
});

export default router;