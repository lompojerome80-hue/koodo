import { Router } from "express";
import db from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

// Bloque un utilisateur (exigence modération UGC) : ses annonces et messages
// disparaissent de l'écran du bloqueur. Blocage directionnel et réversible
// (le déblocage se fait via le support).
router.post("/block", authRequired, (req, res) => {
  const targetId = String(req.body?.userId || "");
  if (!targetId || targetId === req.user.sub) return res.status(400).json({ error: "Utilisateur invalide" });
  const target = db.prepare("SELECT id, full_name FROM users WHERE id=? AND anonymized=0").get(targetId);
  if (!target) return res.status(404).json({ error: "Utilisateur introuvable" });
  db.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?,?)").run(req.user.sub, targetId);
  res.json({ ok: true, blockedId: targetId, name: target.full_name });
});

export default router;