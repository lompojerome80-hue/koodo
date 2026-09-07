import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";
import { chargePayment, feeFor, verifyWebhookSignature } from "../payments/service.js";

const router = Router();

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
    rows.push({ offer, qty, amount: offer.unit_price * qty });
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
  res.json({ ok: true, orderStatus: "escrow" });
});

// L'acheteur confirme la réception → les fonds sont libérés au vendeur.
router.post("/confirm", authRequired, (req, res) => {
  const { txId } = req.body || {};
  if (!txId) return res.status(400).json({ error: "txId requis" });
  const rows = db.prepare("SELECT * FROM transactions WHERE client_ref=?").all(txId);
  if (!rows.length) return res.status(404).json({ error: "Achat introuvable" });
  if (rows.some((r) => r.buyer_id !== req.user.sub)) return res.status(403).json({ error: "Seul l'acheteur peut confirmer la réception" });
  db.prepare("UPDATE transactions SET order_status='delivered', disputed=0, confirmed_at=datetime('now') WHERE client_ref=?").run(txId);
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