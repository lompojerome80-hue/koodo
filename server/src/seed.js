import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import db from "./db.js";

// Source unique des prix marché (villes × produits) : market-data.json à la racine.
const MARKET = JSON.parse(
  readFileSync(new URL("../../market-data.json", import.meta.url), "utf-8")
);
const CITIES = MARKET.cities;
const PRODUCTS = MARKET.products;
const PRICES = MARKET.prices;

export function seedUsers() {
  const hash = bcrypt.hashSync("password123", 10);
  const users = [
    ["Issouf Ouattara", "+2260701000001", "producer", "Pissy", "Ouagadougou"],
    ["Aminata Ouédraogo", "+2260701000002", "producer", "Gounghin", "Ouagadougou"],
    ["Jean Traoré", "+2260701000003", "buyer", "Ouaga 2000", "Ouagadougou"],
    ["Fatou Sawadogo", "+2260701000004", "buyer", "Ouagadougou", "Ouagadougou"],
    ["Dina Zongo", "+2260701000005", "courier", "Bobo-Dioulasso", "Bobo-Dioulasso"],
    ["Abdoulaye Koné", "+2260701000006", "admin", "Ouagadougou", "Ouagadougou"],
  ];
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO users (id, full_name, phone, password, role, village, region, verified)
     VALUES (?,?,?,?,?,?,?,1)`
  );
  for (const [name, phone, role, village, region] of users) {
    stmt.run(nanoid(), name, phone, hash, role, village, region);
  }

  // Migration : anciens comptes démo Côte d'Ivoire (+225 / Bouaké) → Burkina Faso.
  const legacyMap = {
    "+2250701000001": ["Issouf Ouattara", "+2260701000001", "producer", "Pissy", "Ouagadougou"],
    "+2250701000002": ["Aminata Ouédraogo", "+2260701000002", "producer", "Gounghin", "Ouagadougou"],
    "+2250701000003": ["Jean Traoré", "+2260701000003", "buyer", "Ouaga 2000", "Ouagadougou"],
    "+2250701000004": ["Fatou Sawadogo", "+2260701000004", "buyer", "Ouagadougou", "Ouagadougou"],
    "+2250701000005": ["Dina Zongo", "+2260701000005", "courier", "Bobo-Dioulasso", "Bobo-Dioulasso"],
    "+2250701000006": ["Abdoulaye Koné", "+2260701000006", "admin", "Ouagadougou", "Ouagadougou"],
  };
  const legacy = db.prepare("SELECT COUNT(*) c FROM users WHERE phone LIKE '+225%' OR region = 'Bouaké'").get().c;
  if (legacy > 0) {
    const upd = db.prepare("UPDATE users SET full_name=?, phone=?, role=?, village=?, region=? WHERE phone=?");
    for (const [oldPhone, [name, phone, role, village, region]] of Object.entries(legacyMap)) {
      if (db.prepare("SELECT id FROM users WHERE phone=?").get(oldPhone)) {
        upd.run(name, phone, role, village, region, oldPhone);
      }
    }
    console.log("[seed] comptes démo migrés vers le Burkina Faso");
  }
}

// Migre une base déjà seedée avec l'ancien jeu de données (marchés de Côte
// d'Ivoire) vers la nouvelle base "villes du Burkina Faso" (6 villes, ~47
// produits, prix réels). Idempotent : probe sur la présence de "ouagadougou".
export function seedDataset() {
  const probe = db.prepare("SELECT COUNT(*) c FROM markets WHERE id = ?").get("ouagadougou");
  if (probe.c > 0) return;

  db.exec(`
    DELETE FROM messages;
    DELETE FROM offers;
    DELETE FROM alerts;
    DELETE FROM prices;
    DELETE FROM markets;
    DELETE FROM crops;
  `);

  const stmM = db.prepare(
    `INSERT INTO markets (id, name, region, lat, lng) VALUES (?,?,?,?,?)`
  );
  for (const c of CITIES) stmM.run(c.id, c.name, c.name, c.lat, c.lng);

  const stmC = db.prepare(`INSERT INTO crops (id, name, unit, emoji) VALUES (?,?,?,?)`);
  for (const p of PRODUCTS) stmC.run(p.id, p.name, p.unit, p.emoji || "");

  const stmP = db.prepare(
    `INSERT INTO prices (id, crop_id, market_id, min_price, max_price, avg_price, source)
     VALUES (?,?,?,?,?,?,'reporter')`
  );
  for (const pr of PRICES) {
    stmP.run(nanoid(), pr.product, pr.city, pr.price, pr.price, pr.price);
  }
}

export function seed() {
  seedUsers();
  seedDataset();
  const counts = {
    users: db.prepare("SELECT COUNT(*) c FROM users").get().c,
    markets: db.prepare("SELECT COUNT(*) c FROM markets").get().c,
    crops: db.prepare("SELECT COUNT(*) c FROM crops").get().c,
    prices: db.prepare("SELECT COUNT(*) c FROM prices").get().c,
  };
  console.log("Koodo DB seeded:", counts);
}

const scriptPath = process.argv[1]?.split("\\").join("/");
const normalizedSelf = fileURLToPath(import.meta.url).split("\\").join("/");
if (scriptPath === normalizedSelf) {
  seed();
}
