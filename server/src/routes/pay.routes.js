import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";
import { chargePayment, feeFor, verifyWebhookSignature } from "../payments/service.js";
import { notifyUser } from "../notify.js";
import { pushTo } from "../realtime.js";

const router = Router();

// Notifie chaque vendeur concerné d'une nouvelle commande (avec la
// localisation de livraison envoyée par l'acheteur).
function notifySellers(rows, req, delivery) {
  const bySeller = new Map();
  for (const r of rows) {
    if (!bySeller.has(r.offer.user_id)) bySeller.set(r.offer.user_id, []);
    bySeller.get(r.offer.user_id).push(r);
  }
  const buyer = db.prepare("SELECT full_name, phone, avatar FROM users WHERE id=?").get(req.user.sub);
  const buyerName = buyer?.full_name || "Un client";
  const buyerPhone = buyer?.phone || "";
  for (const [sellerId, lines] of bySeller) {
    const qtyTotal = lines.reduce((s, l) => s + l.qty, 0);
    const total = lines.reduce((s, l) => s + l.amount, 0);
    const first = lines[0];
    let body = `${buyerName}${buyerPhone ? ` (${buyerPhone})` : ""} · ${qtyTotal} kg pour ${total.toLocaleString("fr-FR")} F`;
    if (delivery) {
      const where = delivery.label || `${delivery.lat}, ${delivery.lng}`;
      body += `\n📍 À livrer ici : ${where}`;
      if (delivery.note) body += ` — ${delivery.note}`;
    }
    notifyUser(sellerId, {
      kind: "order",
      title: `Nouvelle commande · ${first.cropName}`,
      body,
      actor_name: buyerName,
      actor_photo: buyer?.avatar || null,
      offer_id: first.offer.id,
    });
    // Temps réel : la cloche du vendeur s'allume dès la commande.
    pushTo(sellerId, { type: "order", offerId: first.offer.id });
  }
}

// Initiation d'un paiement Mobile Money.
// Corps accepté (au choix) :
//   { offerId, provider, phone }                    → un seul produit
//   { items: [{offerId, qtyKg}], provider, phone }  → panier multi-produits
// Options : delivery { lat, lng, label, note } pour la livraison.
// En sandbox : référence simulée. En réel : initiation CinetPay.
router.post("/charge", authRequired, async (req, res) => {
  const { offerId, items, provider, phone, delivery } = req.body || {};
  if (!provider || !phone) return res.status(400).json({ error: "provider et phone requis" });

  // Résolution des lignes tout en gardant les prix serveur comme référence.
  const lines = [];
  if (offerId) {
    lines.push({ offerId, qtyKg: req.body.qtyKg || null });
  } else if (Array.isArray(items) && items.length) {
    for (const it of items) lines.push({ offerId: it.offerId, qtyKg: Number(it.qtyKg) });
  } else {
    return res.status(400).json({ error: "offerId ou items requis" });
  }

  const rows = [];
  for (const line of lines) {
    const offer = db.prepare("SELECT * FROM offers WHERE id=? AND status='open'").get(line.offerId);
    if (!offer) return res.status(404).json({ error: "Annonce introuvable ou expirée" });
    if (offer.user_id === req.user.sub) return res.status(403).json({ error: "Impossible d'acheter sa propre annonce" });
    const qty = Number(line.qtyKg) || offer.quantity;
    if (qty > offer.quantity) return res.status(400).json({ error: `Quantité insuffisante pour ${offer.crop_name}` });
    const cropInfo = db.prepare("SELECT c.name crop_name, c.emoji FROM crops c WHERE c.id=?").get(offer.crop_id);
    rows.push({ offer, qty, amount: offer.unit_price * qty, cropName: cropInfo ? `${cropInfo.emoji} ${cropInfo.crop_name}` : "l'annonce" });
  }

  const amount = rows.reduce((s, r) => s + r.amount, 0);
  const fee = feeFor(amount, provider);

  try {
    const { ref, mode } = await chargePayment({ amount, phone, provider, description: `Achat Koodo (${rows.length} article(s))` });
    // Trace serveur de l'initiation (statut confirmé via webhook en production).
    const txIds = rows.map((r) => {
      const txId = nanoid();
      db.prepare(
        `INSERT INTO transactions (id, offer_id, buyer_id, amount, fee, provider, status, reference, qty_kg, location_lat, location_lng, delivery_note)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        txId, r.offer.id, req.user.sub, r.amount, fee, provider, "pending", ref, r.qty,
        Number(delivery?.lat) || null, Number(delivery?.lng) || null, typeof delivery?.note === "string" ? delivery.note : null
      );
      return txId;
    });
    // Le vendeur reçoit la commande et la position de l'acheteur.
    notifySellers(rows, req, delivery);
    res.json({ ref, amount, fee, total: amount + fee, mode, txIds, delivery: delivery || null });
  } catch (err) {
    if (req.app.get("env") !== "production") console.error("[pay]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Webhook CinetPay : confirmation réelle du paiement.
// En production (PAYMENTS_MODE=reel), vérifier la signature avant
// de marquer la transaction "paid" — voir service.verifyWebhookSignature.
router.post("/webhook", (req, res) => {
  const body = req.body || {};
  if (!verifyWebhookSignature(req.headers, body)) {
    return res.status(200).json({ ok: true, note: "signature non vérifiée — transaction non activée" });
  }
  if (body.transaction_id) {
    db.prepare("UPDATE transactions SET status='paid' WHERE reference=? OR id=?").run(body.transaction_id, body.transaction_id);
  }
  res.json({ ok: true });
});

// Enregistre un paiement client (mode démo / escrow) : les fonds sont
// "mis en attente" jusqu'à confirmation de la livraison par l'acheteur.
router.post("/register", authRequired, (req, res) => {
  const { txId, items, amount, fee, provider, ref, buyerPhone, delivery } = req.body || {};
  if (!txId || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "txId et items requis" });
  }
  // Idempotence : ré-écriture du même reçu client.
  db.prepare("DELETE FROM transactions WHERE client_ref=?").run(txId);
  const insert = db.prepare(
    `INSERT INTO transactions (id, offer_id, buyer_id, amount, fee, provider, status, reference, client_ref, qty_kg, location_lat, location_lng, delivery_note, order_status, delivery_label)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  for (const it of items) {
    const offer = db.prepare("SELECT id FROM offers WHERE id=?").get(it.offerId);
    if (!offer) continue;
    insert.run(
      nanoid(), it.offerId, req.user.sub, Number(it.amount), Number(fee) || 0, provider, "paid",
      ref || null, txId, Number(it.qtyKg) || null,
      Number(delivery?.lat) || null, Number(delivery?.lng) || null,
      typeof delivery?.note === "string" ? delivery.note : null, "escrow",
      typeof delivery?.label === "string" ? delivery.label : null
    );
  }
  // Notifie les vendeurs : nouvelle commande + position de livraison de l'acheteur.
  try {
    const sellerLines = items.map((it) => {
      const offer = db.prepare("SELECT * FROM offers WHERE id=?").get(it.offerId);
      const cropInfo = offer && db.prepare("SELECT c.name crop_name, c.emoji FROM crops c WHERE c.id=?").get(offer.crop_id);
      return offer ? { offer, qty: Number(it.qtyKg) || offer.quantity, amount: Number(it.amount), cropName: cropInfo ? `${cropInfo.emoji} ${cropInfo.crop_name}` : "l'annonce" } : null;
    }).filter(Boolean);
    if (sellerLines.length) notifySellers(sellerLines, req, delivery);
  } catch {
    /* la commande reste tracée même si la notification échoue */
  }
  res.json({ ok: true, orderStatus: "escrow" });
});

// L'acheteur confirme la réception → les fonds sont libérés au vendeur.
// Tant qu'un livreur est en course (récupérée ou en route), la libération reste
// bloquée : l'acheteur débloque la somme dès que le colis est remis.
router.post("/confirm", authRequired, (req, res) => {
  const { txId } = req.body || {};
  if (!txId) return res.status(400).json({ error: "txId requis" });
  const rows = db.prepare("SELECT * FROM transactions WHERE client_ref=?").all(txId);
  if (!rows.length) return res.status(404).json({ error: "Achat introuvable" });
  if (rows.some((r) => r.buyer_id !== req.user.sub)) return res.status(403).json({ error: "Seul l'acheteur peut confirmer la réception" });
  const active = db.prepare(
    "SELECT status FROM deliveries WHERE tx_ref = ? AND status IN ('open','accepted','picked_up') LIMIT 1"
  ).get(txId);
  if (active) {
    return res.status(409).json({ error: "La commande est en cours de livraison — les fonds seront libérés à la remise du colis" });
  }
  db.prepare("UPDATE transactions SET order_status='delivered', disputed=0, confirmed_at=datetime('now') WHERE client_ref=?").run(txId);
  // Temps réel : le(s) vendeur(s) voient la commande passer dans « Validées ».
  const sellers = new Set();
  for (const r of rows) {
    const o = db.prepare("SELECT user_id FROM offers WHERE id=?").get(r.offer_id);
    if (o?.user_id && o.user_id !== req.user.sub) sellers.add(o.user_id);
  }
  for (const sid of sellers) pushTo(sid, { type: "order", offerId: rows[0].offer_id });
  res.json({ ok: true, orderStatus: "delivered" });
});

// Litige : l'acheteur ou le vendeur bloque la libération des fonds.
router.post("/dispute", authRequired, (req, res) => {
  const { txId, reason } = req.body || {};
  if (!txId) return res.status(400).json({ error: "txId requis" });
  const rows = db.prepare("SELECT * FROM transactions WHERE client_ref=?").all(txId);
  if (!rows.length) return res.status(404).json({ error: "Achat introuvable" });
  const can = rows.some((r) => r.buyer_id === req.user.sub) ||
    rows.some((r) => db.prepare("SELECT user_id FROM offers WHERE id=?").get(r.offer_id)?.user_id === req.user.sub);
  if (!can) return res.status(403).json({ error: "Non autorisé" });
  db.prepare("UPDATE transactions SET disputed=1, dispute_reason=? WHERE client_ref=?").run(String(reason || "").slice(0, 300), txId);
  res.json({ ok: true });
});

// Vue vendeur : les commandes reçues, avec les infos du client (nom,
// téléphone) et sa position de livraison envoyée au moment de la commande.
// Groupées par client_ref (un panier = une commande), chaque commande garde
// le lien vers sa course (deliveries.tx_ref) quand elle a été confiée.
router.get("/orders", authRequired, (req, res) => {
  const rows = db.prepare(
    `SELECT t.client_ref txId, t.offer_id, t.amount, t.qty_kg, t.order_status, t.disputed,
            t.created_at, t.location_lat lat, t.location_lng lng,
            t.delivery_label dlabel, t.delivery_note dnote,
            o.crop_id, c.name crop_name, c.emoji crop_emoji,
            u.full_name buyer_name, u.phone buyer_phone,
            (SELECT d2.id FROM deliveries d2 WHERE d2.tx_ref = t.client_ref
               AND d2.status != 'cancelled' ORDER BY d2.created_at DESC LIMIT 1) delivery_id
     FROM transactions t
     JOIN offers o ON o.id = t.offer_id
     JOIN crops c ON c.id = o.crop_id
     JOIN users u ON u.id = t.buyer_id
     WHERE o.user_id = ? AND t.status = 'paid'
     ORDER BY t.created_at DESC`
  ).all(req.user.sub);

  const orders = new Map();
  for (const r of rows) {
    let g = orders.get(r.txId);
    if (!g) {
      g = {
        txId: r.txId,
        createdAt: r.created_at,
        status: r.order_status,
        disputed: r.disputed === 1,
        amount: 0,
        qty: 0,
        items: [],
        buyerName: r.buyer_name,
        buyerPhone: r.buyer_phone,
        delivery: null,
        deliveryId: r.delivery_id || null,
      };
      orders.set(r.txId, g);
    }
    g.amount += Number(r.amount) || 0;
    g.qty += Number(r.qty_kg) || 0;
    g.delivery = {
      label: r.dlabel || null,
      lat: r.lat != null ? Number(r.lat) : null,
      lng: r.lng != null ? Number(r.lng) : null,
      note: r.dnote || null,
    };
    g.items.push({
      offerId: r.offer_id,
      cropName: `${r.crop_emoji || ""} ${r.crop_name}`.trim(),
      qtyKg: Number(r.qty_kg) || 0,
      amount: Number(r.amount) || 0,
    });
  }

  const moveCache = new Map();
  const out = [...orders.values()].map((g) => {
    let deliveryMove = null;
    if (g.deliveryId) {
      if (!moveCache.has(g.deliveryId)) {
        moveCache.set(
          g.deliveryId,
          db.prepare(
            `SELECT d.id, d.status, u.full_name courier_name
             FROM deliveries d LEFT JOIN users u ON u.id = d.courier_id
             WHERE d.id = ?`
          ).get(g.deliveryId)
        );
      }
      const dm = moveCache.get(g.deliveryId);
      deliveryMove = dm ? { id: dm.id, status: dm.status, courierName: dm.courier_name || null } : null;
    }
    return { txId: g.txId, createdAt: g.createdAt, status: g.status, disputed: g.disputed,
      amount: g.amount, qty: g.qty, items: g.items, buyerName: g.buyerName,
      buyerPhone: g.buyerPhone, delivery: g.delivery, deliveryMove };
  });
  res.json({ orders: out });
});

// Vue acheteur : ses achats (fonds en attente ou libérés), groupés par panier
// (client_ref), avec le vendeur, la position de livraison et le suivi de la
// course. releaseable = la course est terminée (ou aucune course) et les fonds
// sont encore en escrow → l'acheteur peut alors les libérer au vendeur.
router.get("/purchases", authRequired, (req, res) => {
  const rows = db.prepare(
    `SELECT t.client_ref txId, t.offer_id, t.amount, t.qty_kg, t.order_status, t.disputed,
            t.provider, t.reference, t.created_at,
            t.location_lat lat, t.location_lng lng,
            t.delivery_label dlabel, t.delivery_note dnote,
            o.crop_id, c.name crop_name, c.emoji crop_emoji,
            s.full_name seller_name, s.phone seller_phone,
            (SELECT d2.id FROM deliveries d2 WHERE d2.tx_ref = t.client_ref
               AND d2.status != 'cancelled' ORDER BY d2.created_at DESC LIMIT 1) delivery_id
     FROM transactions t
     JOIN offers o ON o.id = t.offer_id
     JOIN crops c ON c.id = o.crop_id
     JOIN users s ON s.id = o.user_id
     WHERE t.buyer_id = ? AND t.status = 'paid'
     ORDER BY t.created_at DESC`
  ).all(req.user.sub);

  const orders = new Map();
  for (const r of rows) {
    let g = orders.get(r.txId);
    if (!g) {
      g = {
        txId: r.txId,
        createdAt: r.created_at,
        status: r.order_status,
        disputed: r.disputed === 1,
        amount: 0,
        qty: 0,
        items: [],
        sellerName: r.seller_name,
        sellerPhone: r.seller_phone,
        provider: r.provider,
        reference: r.reference,
        delivery: null,
        deliveryId: r.delivery_id || null,
      };
      orders.set(r.txId, g);
    }
    g.amount += Number(r.amount) || 0;
    g.qty += Number(r.qty_kg) || 0;
    g.delivery = {
      label: r.dlabel || null,
      lat: r.lat != null ? Number(r.lat) : null,
      lng: r.lng != null ? Number(r.lng) : null,
      note: r.dnote || null,
    };
    g.items.push({
      offerId: r.offer_id,
      cropName: `${r.crop_emoji || ""} ${r.crop_name}`.trim(),
      qtyKg: Number(r.qty_kg) || 0,
      amount: Number(r.amount) || 0,
    });
  }

  const moveCache = new Map();
  const out = [...orders.values()].map((g) => {
    let deliveryMove = null;
    if (g.deliveryId) {
      if (!moveCache.has(g.deliveryId)) {
        moveCache.set(
          g.deliveryId,
          db.prepare(
            `SELECT d.id, d.status, u.full_name courier_name
             FROM deliveries d LEFT JOIN users u ON u.id = d.courier_id
             WHERE d.id = ?`
          ).get(g.deliveryId)
        );
      }
      const dm = moveCache.get(g.deliveryId);
      deliveryMove = dm ? { id: dm.id, status: dm.status, courierName: dm.courier_name || null } : null;
    }
    const escrow = g.status === "escrow" && !g.disputed;
    const courseFinished = !deliveryMove || deliveryMove.status === "done" || deliveryMove.status === "cancelled";
    return {
      txId: g.txId, createdAt: g.createdAt, status: g.status, disputed: g.disputed,
      amount: g.amount, qty: g.qty, items: g.items, sellerName: g.sellerName,
      sellerPhone: g.sellerPhone, provider: g.provider, reference: g.reference,
      delivery: g.delivery, deliveryMove, releaseable: escrow && courseFinished,
    };
  });
  res.json({ purchases: out });
});

// Vue vendeur : fonds en attente (escrow), libérés et litiges.
router.get("/escrow", authRequired, (req, res) => {
  const rows = db.prepare(
    `SELECT t.order_status, t.amount, t.disputed
     FROM transactions t JOIN offers o ON o.id=t.offer_id
     WHERE o.user_id=? AND t.status='paid'`
  ).all(req.user.sub);
  const sum = (pred) => rows.filter(pred).reduce((s, r) => s + Number(r.amount), 0);
  const cnt = (pred) => rows.filter(pred).length;
  res.json({
    escrow: { amount: sum((r) => r.order_status === "escrow" && !r.disputed), count: cnt((r) => r.order_status === "escrow" && !r.disputed) },
    delivered: { amount: sum((r) => r.order_status === "delivered"), count: cnt((r) => r.order_status === "delivered") },
    disputed: { amount: sum((r) => r.disputed), count: cnt((r) => r.disputed) },
  });
});

export default router;