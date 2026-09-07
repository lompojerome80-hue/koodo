import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

const REF = { lat: 12.3714, lng: -1.5197 }; // Ouagadougou (référence d'affichage par défaut)

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

// Prix d'une culture (ou de toutes), triés du meilleur (le moins cher) au plus élevé.
router.get("/prices", (req, res) => {
  const cropId = req.query.crop;
  let rows;
  if (cropId) {
    rows = db.prepare(
      `SELECT p.avg_price price, p.min_price, p.max_price, p.source, p.report_count, p.updated_at, m.id market_id, m.name market, m.lat, m.lng
       FROM prices p JOIN markets m ON m.id = p.market_id
       WHERE p.crop_id = ?
       ORDER BY p.avg_price ASC`
    ).all(cropId);
  } else {
    rows = db.prepare(
      `SELECT p.crop_id, p.avg_price price, p.min_price, p.max_price, p.source, p.report_count, p.updated_at, m.name market, m.id market_id, m.lat, m.lng
       FROM prices p JOIN markets m ON m.id = p.market_id`
    ).all();
  }
  const out = rows.map((r) => ({
    ...r,
    distance: r.lat != null && r.lng != null ? haversineKm(REF, r) : 0,
  }));
  res.json(out.length ? (cropId ? { crop: cropId, prices: out } : out) : { prices: [] });
});

router.get("/crops", (req, res) => {
  const crops = db.prepare("SELECT * FROM crops ORDER BY name").all();
  res.json(crops);
});

router.get("/markets", (req, res) => {
  const markets = db.prepare("SELECT * FROM markets ORDER BY name").all();
  res.json(markets);
});

// Price history for a crop (fake recent trend by market)
router.get("/trend", (req, res) => {
  const cropId = req.query.crop || "mais";
  const rows = db.prepare(
    `SELECT m.name market, p.min_price, p.max_price, p.avg_price FROM prices p JOIN markets m ON m.id=p.market_id WHERE p.crop_id=?`
  ).all(cropId);
  const trend = rows.map((r, i) => {
    const base = r.avg_price;
    const wiggle = [1, -0.04, 0.03, -0.02, 0.05];
    const start = Math.round(base * (1 - wiggle[i] * 0.5));
    return {
      market: r.market,
      today: Math.round(base),
      weekAgo: start,
      changePct: Math.round(((base - start) / start) * 1000) / 10,
    };
  });
  res.json(trend);
});

// Prix du jour signalé par un membre (vendeur/acheteur) pour une ville.
// Radio communautaire anti-fraude : un prix n'est publié qu'après 2
// signalements CONCORDANTS (écart ≤ 5 % ou 100 F) par des membres différents,
// dans les 48 h. Un même membre ne compte qu'une fois par fenêtre.
const REPORT_WINDOW_H = 48;
const REPORTS_TO_PUBLISH = 2;

function clusterOf(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const tol = Math.max(Math.round(median * 0.05), 100);
  return sorted.filter((p) => Math.abs(p - median) <= tol);
}

function publishPrice(cropId, marketId, prices) {
  const confirmed = clusterOf(prices);
  const avg = Math.round(confirmed.reduce((a, b) => a + b, 0) / confirmed.length);
  const min = Math.min(...confirmed);
  const max = Math.max(...confirmed);
  const row = db.prepare("SELECT id FROM prices WHERE crop_id=? AND market_id=?").get(cropId, marketId);
  if (row) {
    db.prepare(
      `UPDATE prices SET min_price=?, max_price=?, avg_price=?, report_count=?, reporter=?, source='community', updated_at=datetime('now')
       WHERE id=?`
    ).run(min, max, avg, confirmed.length, "community", row.id);
  } else {
    db.prepare(
      `INSERT INTO prices (id, crop_id, market_id, min_price, max_price, avg_price, reporter, source, report_count)
       VALUES (?,?,?,?,?,?,?,'community',?)`
    ).run(nanoid(), cropId, marketId, min, max, avg, "community", confirmed.length);
  }
  return avg;
}

router.post("/report", authRequired, (req, res) => {
  const { cropId, marketId, price } = req.body || {};
  const p = Number(price);
  if (!cropId || !marketId || !p || p <= 0)
    return res.status(400).json({ error: "culture, ville et prix (F CFA) requis" });
  const crop = db.prepare("SELECT id FROM crops WHERE id = ?").get(cropId);
  const mkt = db.prepare("SELECT id FROM markets WHERE id = ?").get(marketId);
  if (!crop || !mkt) return res.status(404).json({ error: "culture ou ville inconnue" });

  const uid = req.user.sub || "community";
  const windowStart = `datetime('now', '-${REPORT_WINDOW_H} hours')`;

  // Un même membre ne peut pas compter deux fois dans la fenêtre.
  const dup = db.prepare(
    `SELECT id FROM price_reports WHERE crop_id=? AND market_id=? AND user_id=? AND applied=0 AND created_at >= ${windowStart}`
  ).get(cropId, marketId, uid);
  if (dup) {
    const existing = db
      .prepare(`SELECT price FROM price_reports WHERE crop_id=? AND market_id=? AND created_at >= ${windowStart}`)
      .all(cropId, marketId)
      .map((r) => r.price);
    return res.json({ ok: true, status: "pending", price: existing[0] ?? p, count: clusterOf(existing).length, reportsNeeded: REPORTS_TO_PUBLISH, alreadyReported: true });
  }

  db.prepare(
    `INSERT INTO price_reports (crop_id, market_id, price, user_id) VALUES (?,?,?,?)`
  ).run(cropId, marketId, p, uid);

  const recent = db
    .prepare(`SELECT id, price FROM price_reports WHERE crop_id=? AND market_id=? AND applied=0 AND created_at >= ${windowStart}`)
    .all(cropId, marketId);
  const prices = recent.map((r) => r.price);
  const confirmed = clusterOf(prices);

  if (confirmed.length >= REPORTS_TO_PUBLISH) {
    const avg = publishPrice(cropId, marketId, confirmed);
    const confirmedSet = new Set(recent.filter((r) => confirmed.includes(r.price)).map((r) => r.id));
    const mark = db.prepare(`UPDATE price_reports SET applied=1 WHERE id=?`);
    db.transaction(() => [...confirmedSet].forEach((id) => mark.run(id)))();
    return res.json({ ok: true, status: "published", price: avg, count: confirmed.length, reportsNeeded: REPORTS_TO_PUBLISH });
  }

  res.json({ ok: true, status: "pending", price: p, count: confirmed.length, reportsNeeded: REPORTS_TO_PUBLISH });
});

export default router;
