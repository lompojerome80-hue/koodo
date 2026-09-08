import { nanoid } from "nanoid";
import db from "./db.js";

// Crée une notification "sticky" : le destinataire la voit dans son centre de
// notifications à sa prochaine lecture (pas besoin qu'il soit en ligne).
export function notifyUser(userId, notif) {
  if (!userId) return;
  db.prepare(
    `INSERT INTO notifications (id, user_id, kind, title, body, actor_name, actor_photo, offer_id, delivery_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    nanoid(),
    userId,
    notif.kind,
    notif.title,
    notif.body,
    notif.actor_name || null,
    notif.actor_photo || null,
    notif.offer_id || null,
    notif.delivery_id || null
  );
}