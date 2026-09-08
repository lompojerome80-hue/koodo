import { Router } from "express";
import db from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

// Centre de notifications du compte connecté (non lues d'abord, puis récentes).
router.get("/", authRequired, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, kind, title, body, actor_name, actor_photo, offer_id, delivery_id, seen, created_at
       FROM notifications WHERE user_id = ? ORDER BY seen ASC, created_at DESC LIMIT 50`
    )
    .all(req.user.sub);
  const unseen = rows.filter((n) => !n.seen).length;
  res.json({
    notifications: rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      actor_name: n.actor_name,
      actor_photo: n.actor_photo,
      offer_id: n.offer_id,
      delivery_id: n.delivery_id,
      seen: !!n.seen,
      created_at: n.created_at,
    })),
    unseen,
  });
});

// Marque toutes les notifications comme lues.
router.post("/read", authRequired, (req, res) => {
  db.prepare("UPDATE notifications SET seen = 1 WHERE user_id = ?").run(req.user.sub);
  res.json({ ok: true });
});

export default router;