import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";
import { notifyUser } from "../notify.js";
import { pushTo, counterpartOf } from "../realtime.js";
import { saveAudio } from "../uploads.js";

const router = Router();

router.get("/threads", authRequired, (req, res) => {
  const rows = db.prepare(
    `SELECT m.id, m.offer_id,
            CASE WHEN m.kind='voice' THEN '🎤 Message vocal' ELSE m.body END AS body,
            m.kind, m.audio_url, m.duration_ms, m.sender_id, m.created_at,
            o.crop_id, c.name crop_name, c.emoji, o.quantity, o.unit_price,
            other.full_name other_name, other.role other_role,
            (SELECT COUNT(*) FROM messages sub
              WHERE sub.offer_id = m.offer_id AND sub.sender_id <> ? AND sub.seen = 0) AS unread
     FROM messages m
     JOIN offers o ON o.id=m.offer_id
     JOIN crops c ON c.id=o.crop_id
     JOIN users other ON other.id = (SELECT CASE WHEN o.user_id=? THEN sender_id ELSE o.user_id END)
     JOIN (SELECT offer_id, MAX(created_at) mx FROM messages GROUP BY offer_id) last ON last.offer_id=m.offer_id AND last.mx=m.created_at
     WHERE m.sender_id=? OR o.user_id=?
     ORDER BY datetime(m.created_at) DESC`,
  ).all(req.user.sub, req.user.sub, req.user.sub, req.user.sub);
  res.json(rows.map((r) => ({ ...r, unread: Number(r.unread) || 0 })));
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
  const { body, audio, duration } = req.body || {};
  const isVoice = typeof audio === "string" && audio.length > 0;
  if (!isVoice && (!body || !body.trim())) return res.status(400).json({ error: "message vide" });
  const offer = db.prepare("SELECT * FROM offers WHERE id=?").get(req.params.offerId);
  if (!offer) return res.status(404).json({ error: "annonce introuvable" });

  const recipientId = counterpartOf(db, offer, req.user.sub);

  let audioUrl = null;
  let durationMs = null;
  if (isVoice) {
    try {
      audioUrl = saveAudio(audio);
      durationMs = Math.max(0, Math.round(Number(duration) || 0));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (id, offer_id, sender_id, body, kind, audio_url, duration_ms) VALUES (?,?,?,?,?,?,?)`
    ).run(nanoid(), req.params.offerId, req.user.sub, isVoice ? "" : body.trim(), isVoice ? "voice" : "text", audioUrl, durationMs);

    if (recipientId && recipientId !== req.user.sub) {
      const sender = db.prepare("SELECT full_name, avatar FROM users WHERE id=?").get(req.user.sub);
      const offerInfo = db.prepare(
        `SELECT c.name crop_name, c.emoji FROM offers o JOIN crops c ON c.id=o.crop_id WHERE o.id=?`
      ).get(req.params.offerId);
      const crop = offerInfo ? `${offerInfo.emoji} ${offerInfo.crop_name}` : "l'annonce";
      const name = sender?.full_name || "Quelqu'un";
      const preview = isVoice ? "🎤 te laisse un message vocal" : (body.trim().length > 80 ? body.trim().slice(0, 80) + "…" : body.trim());
      notifyUser(recipientId, {
        kind: "message",
        title: `Nouveau message · ${crop}`,
        body: `${name} : ${preview}`,
        actor_name: name,
        actor_photo: sender?.avatar || null,
        offer_id: req.params.offerId,
      });
    } else {
      // Destinataire inconnu (message du vendeur dans une conversation vierge) :
      // il n'y a rien à notifier.
    }
  })();

  // Temps réel : le destinataire (et ses autres appareils) reçoit l'événement.
  if (recipientId) pushTo(recipientId, { type: "message", offerId: req.params.offerId });

  res.status(201).json({ ok: true });
});

// Marque la conversation comme lue pour l'utilisateur courant : ses messages
// entrants passent à "vu" (double coche pour l'autre partie) et les
// notifications de message de cette annonce disparaissent de la cloche.
router.post("/:offerId/read", authRequired, (req, res) => {
  const offer = db.prepare("SELECT * FROM offers WHERE id=?").get(req.params.offerId);
  if (!offer) return res.status(404).json({ error: "annonce introuvable" });

  db.transaction(() => {
    db.prepare(
      "UPDATE messages SET seen = 1 WHERE offer_id=? AND sender_id<>? AND seen = 0"
    ).run(req.params.offerId, req.user.sub);
    db.prepare(
      "UPDATE notifications SET seen = 1 WHERE user_id=? AND kind='message' AND offer_id=? AND seen = 0"
    ).run(req.user.sub, req.params.offerId);
  })();

  // Préviens l'autre partie : ses messages envoyés deviennent "lus" en direct.
  const counterpart = counterpartOf(db, offer, req.user.sub);
  if (counterpart) pushTo(counterpart, { type: "seen", offerId: req.params.offerId });

  res.json({ ok: true });
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