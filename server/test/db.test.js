import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { readFileSync } from "node:fs";
import db from "../src/db.js";

const MARKET = JSON.parse(readFileSync(new URL("../../market-data.json", import.meta.url), "utf-8"));
const EXPECTED_CROPS = MARKET.products.map((p) => p.id).sort();

test("db seeds users with hashed passwords", () => {
  const count = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  assert.ok(count >= 4);
  const user = db.prepare("SELECT * FROM users WHERE phone=?").get("+2260701000001");
  assert.ok(user, "demo producer exists");
  assert.ok(bcrypt.compareSync("password123", user.password), "password validated");
});

test("prices exist for all seeded crops", () => {
  const crops = db.prepare("SELECT COUNT(*) c FROM crops").get().c;
  const prices = db.prepare("SELECT COUNT(*) c FROM prices").get().c;
  assert.ok(crops >= 6);
  assert.ok(prices >= 30);
  const pdf = db.prepare("SELECT DISTINCT crop_id FROM prices").all().map((r) => r.crop_id).sort();
  assert.deepEqual(pdf, EXPECTED_CROPS);
});

test("offer insert has referential integrity", () => {
  const user = db.prepare("SELECT id FROM users LIMIT 1").get();
  const crop = db.prepare("SELECT id FROM crops LIMIT 1").get();
  const id = nanoid();
  db.prepare(
    "INSERT INTO offers (id, user_id, crop_id, quantity, unit_price) VALUES (?,?,?,?,?)"
  ).run(id, user.id, crop.id, 100, 300);
  const row = db.prepare("SELECT * FROM offers WHERE id=?").get(id);
  assert.equal(row.quantity, 100);
  db.prepare("DELETE FROM offers WHERE id=?").run(id);
});