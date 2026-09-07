import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

const threadRow = (t) => {
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
  };
};

// Mes demandes d'aide (utilisateur connecté, quel que soit son rôle).
router.get("/threads", authRequired, (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM support_threads WHERE user_id = ?
       ORDER BY last_message_at DESC`
    )
    .all(req.user.sub);
  res.json({ threads: rows.map(threadRow) });
});

// Ouvrir une demande d'aide (le premier message est créé avec le ticket).
router.post("/threads", authRequired, (req, res) => {
  const subject = String(req.body.subject || "").trim().slice(0, 120);
  const body = String(req.body.body || "").trim().slice(0, 3000);
  if (!subject || !body) {
    return res.status(400).json({ error: "Donne un sujet et écris ton problème" });
  }
  const id = nanoid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO support_threads (id, user_id, subject, status, last_message_at, created_at)
     VALUES (?, ?, ?, 'open', ?, ?)`
  ).run(id, req.user.sub, subject, now, now);
  db.prepare(
    `INSERT INTO support_messages (id, thread_id, sender_role, sender_id, body, created_at)
     VALUES (?, ?, 'user', ?, ?, ?)`
  ).run(nanoid(), id, req.user.sub, body, now);
  const t = db.prepare(`SELECT * FROM support_threads WHERE id = ?`).get(id);
  res.status(201).json({ thread: threadRow(t) });
});

// Messages d'un ticket (uniquement le propriétaire du ticket).
router.get("/threads/:id/messages", authRequired, (req, res) => {
  const t = db.prepare(`SELECT * FROM support_threads WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: "Demande introuvable" });
  if (t.user_id !== req.user.sub) return res.status(403).json({ error: "Ce n'est pas ta demande" });
  const rows = db
    .prepare(
      `SELECT m.id, m.sender_role, m.sender_id, m.body, m.created_at
       FROM support_messages m WHERE m.thread_id = ? ORDER BY m.created_at ASC`
    )
    .all(t.id);
  res.json({ messages: rows, thread: threadRow(t) });
});

// Envoyer un message dans SON ticket.
router.post("/threads/:id/messages", authRequired, (req, res) => {
  const t = db.prepare(`SELECT * FROM support_threads WHERE id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: "Demande introuvable" });
  if (t.user_id !== req.user.sub) return res.status(403).json({ error: "Ce n'est pas ta demande" });
  const body = String(req.body.body || "").trim().slice(0, 3000);
  if (!body) return res.status(400).json({ error: "Message vide" });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO support_messages (id, thread_id, sender_role, sender_id, body, created_at)
     VALUES (?, ?, 'user', ?, ?, ?)`
  ).run(nanoid(), t.id, req.user.sub, body, now);
  db.prepare(
    `UPDATE support_threads SET last_message_at = ?, status = 'open' WHERE id = ?`
  ).run(now, t.id);
  const rows = db
    .prepare(
      `SELECT m.id, m.sender_role, m.sender_id, m.body, m.created_at
       FROM support_messages m WHERE m.thread_id = ? ORDER BY m.created_at ASC`
    )
    .all(t.id);
  res.json({ messages: rows });
});

export default router;