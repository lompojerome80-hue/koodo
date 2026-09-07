import { nanoid } from "nanoid";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = path.join(__dirname, "..", "data", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const MAX_BYTES = 4.5 * 1024 * 1024; // ~4,5 Mo par photo après retaillage côté client
const TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** Décodé une photo (dataURL base64) envoyée par le client et l'écrit sur le disque.
 *  Retourne l'URL publique à stocker. Lève une erreur si le format/taille est invalide. */
export function saveDataUrl(dataUrl, kind = "photo") {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Photo invalide");
  const ext = TYPES[m[1]];
  if (!ext) throw new Error("Format de photo non supporté (JPEG, PNG ou WebP)");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length === 0) throw new Error("Photo vide");
  if (buf.length > MAX_BYTES) {
    throw new Error(`Photo trop lourde (${Math.round(buf.length / 1024)} Ko) — max 4,5 Mo`);
  }
  const name = `${kind}-${nanoid(10)}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, name), buf);
  return `/uploads/${name}`;
}

export function assertPhotos(photos) {
  for (const [field, value] of Object.entries(photos || {})) {
    if (value == null) continue;
    if (typeof value !== "string") throw new Error(`${field} : valeur invalide`);
  }
}