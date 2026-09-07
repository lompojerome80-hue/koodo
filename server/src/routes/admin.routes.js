import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

const adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Réservé à l'administration Koodo" });
  }
  next();
};

// Liste des livreurs avec leur dossier (statut de pièce, blocage, reste à payer).
router.get("/couriers", authRequired, adminOnly, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, full_name, phone, locality, transport, selfie, doc_status, doc_updated_at,
              blocked, blocked_reason
       FROM users WHERE role = 'courier' ORDER BY created_at`
    )
    .all()
    .map((c) => {
      const unpaid = db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) s FROM courier_dues WHERE courier_id = ? AND paid = 0`
        )
        .get(c.id).s;
      return { ...c, totalUnpaid: unpaid };
    });
  res.json({ couriers: rows });
});

// Vérifier la pièce d'identité d'un livreur → la « bannière en cours de
// validation » disparaît côté livreur.
router.post("/couriers/:id/verify", authRequired, adminOnly, (req, res) => {
  const c = db.prepare("SELECT id, full_name, role FROM users WHERE id = ?").get(req.params.id);
  if (!c) return res.status(404).json({ error: "Compte introuvable" });
  if (c.role !== "courier") return res.status(400).json({ error: "Ce compte n'est pas un livreur" });
  db.prepare(
    "UPDATE users SET doc_status = 'verified', doc_updated_at = datetime('now','localtime'), blocked = 0, blocked_reason = NULL WHERE id = ?"
  ).run(c.id);
  res.json({ ok: true, courierId: c.id, fullName: c.full_name });
});

// Paiements (règlements de dû) en attente de confirmation — avec la capture.
router.get("/payments", authRequired, adminOnly, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.amount, p.receipt, p.status, p.created_at, p.confirmed_at,
              u.full_name, u.phone
       FROM payments p JOIN users u ON u.id = p.courier_id
       WHERE p.status = 'pending'
       ORDER BY p.created_at DESC`
    )
    .all();
  res.json({ payments: rows });
});

// Confirmar un règlement avec capture : paie le dû, devrait débloquer le livreur.
router.post("/payments/:id/confirm", authRequired, adminOnly, (req, res) => {
  const p = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Paiement introuvable" });
  if (p.status !== "pending") return res.status(409).json({ error: "Paiement déjà traité" });
  db.prepare(
    "UPDATE payments SET status = 'confirmed', confirmed_at = datetime('now','localtime') WHERE id = ?"
  ).run(p.id);
  // Un règlement confirmé paie le dû en cours du livreur.
  db.prepare(
    `UPDATE courier_dues SET paid = 1, paid_at = datetime('now','localtime')
     WHERE courier_id = ? AND paid = 0`
  ).run(p.courier_id);
  const unpaid = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) s FROM courier_dues WHERE courier_id = ? AND paid = 0`)
    .get(p.courier_id).s;
  if (unpaid === 0) {
    db.prepare("UPDATE users SET blocked = 0, blocked_reason = NULL WHERE id = ?").run(p.courier_id);
  }
  res.json({ ok: true, paymentId: p.id, courierId: p.courier_id });
});

// ---------- Aide / service technique ----------

// Résumé d'un ticket (dernier message, nb de messages, statut).
const supportInfo = (t) => {
  const last = db
    .prepare(
      `SELECT m.body, m.sender_role, m.created_at FROM support_messages m
       WHERE m.thread_id = ? ORDER BY m.created_at DESC LIMIT 1`
    )
    .get(t.id);
  const count = db
    .prepare(`SELECT COUNT(*) c FROM support_messages WHERE thread_id = ?`)
    .get(t.id).c;
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    last_message: last?.body ?? null,
    last_sender: last?.sender_role ?? null,
    last_at: last?.created_at ?? t.created_at,
    message_count: count,
    created_at: t.created_at,
    full_name: t.full_name || "",
    phone: t.phone || "",
  };
};

// Toutes les demandes d'aide (tickets) avec l'utilisateur concerné.
router.get("/support", authRequired, adminOnly, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, u.full_name, u.phone FROM support_threads t
       JOIN users u ON u.id = t.user_id
       ORDER BY t.last_message_at DESC`
    )
    .all();
  res.json({ threads: rows.map(supportInfo) });
});

// Messages d'un ticket (côté admin, accès à tous).
router.get("/support/:id/messages", authRequired, adminOnly, (req, res) => {
  const t = db.prepare(`SELECT * FROM support_threads WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: "Demande introuvable" });
  const rows = db
    .prepare(
      `SELECT m.id, m.sender_role, m.sender_id, m.body, m.created_at
       FROM support_messages m WHERE m.thread_id = ? ORDER BY m.created_at ASC`
    )
    .all(t.id);
  res.json({ messages: rows, thread: supportInfo(t) });
});

// Répondre (service technique).
router.post("/support/:id/messages", authRequired, adminOnly, (req, res) => {
  const t = db.prepare(`SELECT * FROM support_threads WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: "Demande introuvable" });
  const body = String(req.body.body || "").trim().slice(0, 3000);
  if (!body) return res.status(400).json({ error: "Message vide" });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO support_messages (id, thread_id, sender_role, sender_id, body, created_at)
     VALUES (?, ?, 'admin', ?, ?, ?)`
  ).run(nanoid(), t.id, req.user.sub, body, now);
  db.prepare(
    `UPDATE support_threads SET last_message_at = ?, status = 'answered' WHERE id = ?`
  ).run(now, t.id);
  res.json({ ok: true, thread: supportInfo(t) });
});

export default router;