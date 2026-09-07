// ============================================================
// Seed Firebase — à exécuter une seule fois (ou plusieurs fois,
// il est idempotent via setDoc).
//
// Pré-requis :
//   1. npm install --save-dev firebase-admin
//   2. Télécharge ton compte de service (Console > Project > Réglages
//      > Comptes de service > Générer une nouvelle clé privée)
//   3. Lance :  $env:GOOGLE_APPLICATION_CREDENTIALS="chemin/svc.json"  (PowerShell)
//      npm run seed:firebase
// ============================================================

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase-admin/firestore";

import { readFileSync } from "node:fs";

const svcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!svcPath) {
  console.error("Définis GOOGLE_APPLICATION_CREDENTIALS vers ton fichier de compte de service.");
  process.exit(1);
}

const svc = JSON.parse(readFileSync(svcPath, "utf-8"));
initializeApp({ credential: cert(svc), projectId: svc.project_id });
const db = getFirestore();

const JSON_DATA = JSON.parse(readFileSync(new URL("../market-data.json", import.meta.url), "utf-8"));
const CROPS = JSON_DATA.products;
const MARKETS = JSON_DATA.cities.map((c) => ({ id: c.id, name: c.name, region: c.name, distance: 0 }));
const PRICES = JSON_DATA.prices;

async function main() {
  const writes = [];
  for (const c of CROPS) {
    writes.push(setDoc(doc(db, "crops", c.id), { ...c, createdAt: serverTimestamp() }));
  }
  for (const m of MARKETS) {
    writes.push(setDoc(doc(db, "markets", m.id), { ...m, lat: JSON_DATA.cities.find((x) => x.id === m.id).lat, lng: JSON_DATA.cities.find((x) => x.id === m.id).lng, createdAt: serverTimestamp() }));
  }
  for (const p of PRICES) {
    const city = JSON_DATA.cities.find((x) => x.id === p.city);
    writes.push(
      setDoc(doc(db, "prices", `${p.product}_${p.city}`), {
        cropId: p.product,
        marketId: p.city,
        marketName: city.name,
        distance: 0,
        lat: city.lat,
        lng: city.lng,
        min: p.price,
        max: p.price,
        avg: p.price,
        updatedAt: serverTimestamp(),
      })
    );
  }
  await Promise.all(writes);
  console.log(`Seed terminé : ${CROPS.length} cultures, ${MARKETS.length} marchés, ${PRICES.length} prix.`);
}

main().catch((e) => { console.error(e); process.exit(1); });