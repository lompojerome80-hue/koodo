import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

router.get("/", authRequired, (req, res) => {
  const rows = db.prepare(
    `SELECT a.*, c.name crop_name, c.emoji FROM alerts a JOIN crops c ON c.id=a.crop_id WHERE a.user_id=?`
  ).all(req.user.sub);
  res.json(rows);
});

router.post("/", authRequired, (req, res) => {
  const { cropId, targetPrice } = req.body || {};
  if (!cropId || !Number(targetPrice)) return res.status(400).json({ error: "culture et prix cible requis" });
  const id = nanoid();
  db.prepare(
    `INSERT INTO alerts (id, user_id, crop_id, target_price) VALUES (?,?,?,?)`
  ).run(id, req.user.sub, cropId, Number(targetPrice));
  const row = db.prepare("SELECT * FROM alerts WHERE id=?").get(id);
  res.status(201).json({ alert: row });
});

router.delete("/:id", authRequired, (req, res) => {
  db.prepare("DELETE FROM alerts WHERE id=? AND user_id=?").run(req.params.id, req.user.sub);
  res.json({ ok: true });
});

export default router;
