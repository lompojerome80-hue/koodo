import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

router.get("/threads", authRequired, (req, res) => {
  const rows = db.prepare(
    `SELECT m.id, m.offer_id, m.body, m.sender_id, m.created_at,
            o.crop_id, c.name crop_name, c.emoji, o.quantity, o.unit_price,
            other.full_name other_name, other.role other_role
     FROM messages m
     JOIN offers o ON o.id=m.offer_id
     JOIN crops c ON c.id=o.crop_id
     JOIN users other ON other.id = (SELECT CASE WHEN o.user_id=? THEN sender_id ELSE o.user_id END)
     JOIN (SELECT offer_id, MAX(created_at) mx FROM messages GROUP BY offer_id) last ON last.offer_id=m.offer_id
     WHERE m.sender_id=? OR o.user_id=?
     ORDER BY datetime(m.created_at) DESC`,
  ).all(req.user.sub, req.user.sub, req.user.sub);
  res.json(rows);
});

router.get("/:offerId", authRequired, (req, res) => {
  const offer = db.prepare("SELECT * FROM offers WHERE id=?").get(req.params.offerId);
  if (!offer) return res.status(404).json({ error: "annonce introuvable" });
  if (offer.user_id !== req.user.sub && req.user.role !== "buyer" && req.user.role !== "admin") {
    return res.status(403).json({ error: "non autorisé" });
  }
  const msgs = db.prepare(
    `SELECT m.*, u.full_name sender_name FROM messages m JOIN users u ON u.id=m.sender_id
     WHERE m.offer_id=? ORDER BY datetime(m.created_at) ASC`
  ).all(req.params.offerId);
  res.json(msgs);
});

router.post("/:offerId", authRequired, (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: "message vide" });
  const offer = db.prepare("SELECT * FROM offers WHERE id=?").get(req.params.offerId);
  if (!offer) return res.status(404).json({ error: "annonce introuvable" });
  db.prepare(
    `INSERT INTO messages (id, offer_id, sender_id, body) VALUES (?,?,?,?)`
  ).run(nanoid(), req.params.offerId, req.user.sub, body.trim());
  res.status(201).json({ ok: true });
});

// Suppression d'un message : expéditeur, propriétaire de l'annonce ou admin.
router.delete("/:offerId/:messageId", authRequired, (req, res) => {
  const msg = db.prepare("SELECT * FROM messages WHERE id=?").get(req.params.messageId);
  if (!msg) return res.status(404).json({ error: "message introuvable" });
  const offer = db.prepare("SELECT user_id FROM offers WHERE id=?").get(req.params.offerId);
  const isSender = msg.sender_id === req.user.sub;
  const isOwner = offer && (offer.user_id === req.user.sub || req.user.role === "admin");
  if (!isSender && !isOwner) return res.status(403).json({ error: "non autorisé" });
  db.prepare("DELETE FROM messages WHERE id=?").run(req.params.messageId);
  res.json({ ok: true });
});

export default router;
