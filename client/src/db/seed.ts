import type { Crop, PriceRow } from "../types";
import MARKET from "../../../market-data.json";

// Miroir local des données de marché — utilisé comme seed automatique dans
// Firebase (si collections vides) et comme repli hors ligne en mode démo.
// Source unique : market-data.json (racine du projet).

export interface MarketRow {
  id: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
}

const CITIES = MARKET.cities;
const PRODUCTS = MARKET.products;
const PRICE_ROWS = MARKET.prices;

export const SEED_CROPS: Crop[] = PRODUCTS.map((p) => ({
  id: p.id,
  name: p.name,
  unit: p.unit,
  emoji: p.emoji,
}));

export const SEED_MARKETS: MarketRow[] = CITIES.map((c) => ({
  id: c.id,
  name: c.name,
  region: c.name,
  lat: c.lat,
  lng: c.lng,
}));

// Référence par défaut pour l'affichage "distance" : Ouagadougou (centre de la
// démo). L'écran des prix recalcule la distance réelle depuis la position
// géolocalisée de l'utilisateur quand elle est disponible.
export const REF_POINT = { lat: 12.3714, lng: -1.5197 };

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

export function seedPricesFor(cropId: string): PriceRow[] {
  return PRICE_ROWS.filter((p) => p.product === cropId)
    .map((p) => {
      const c = CITIES.find((x) => x.id === p.city);
      return {
        market_id: p.city,
        market: c?.name || p.city,
        distance: c ? haversineKm(REF_POINT, c) : 0,
        min_price: p.price,
        max_price: p.price,
        price: p.price,
        lat: c?.lat,
        lng: c?.lng,
      };
    })
    .sort((a, b) => a.price - b.price); // meilleur prix = le moins cher d'abord
}

export function jitterRows(rows: PriceRow[]): PriceRow[] {
  return rows.map((r) => ({
    ...r,
    price: Math.max(1, r.price + Math.round((Math.random() - 0.5) * 14)),
  }));
}