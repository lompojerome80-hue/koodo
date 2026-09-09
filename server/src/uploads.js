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
const AUDIO_TYPES = {
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
};
const MAX_AUDIO_BYTES = 4.5 * 1024 * 1024; // ~4,5 Mo par vocal (~2 min en opus)

function writeBase64(dataUrl, kind, types, maxBytes) {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Fichier invalide");
  const ext = types[m[1]];
  if (!ext) throw new Error("Format non supporté pour ce type de fichier");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length === 0) throw new Error("Fichier vide");
  if (buf.length > maxBytes) {
    throw new Error(`Fichier trop lourd (${Math.round(buf.length / 1024)} Ko) — max ${Math.round(maxBytes / 1024 / 1024 * 10) / 10} Mo`);
  }
  const name = `${kind}-${nanoid(10)}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, name), buf);
  return `/uploads/${name}`;
}

/** Décodé une photo (dataURL base64) envoyée par le client et l'écrit sur le disque.
 *  Retourne l'URL publique à stocker. Lève une erreur si le format/taille est invalide. */
export function saveDataUrl(dataUrl, kind = "photo") {
  return writeBase64(dataUrl, kind, TYPES, MAX_BYTES);
}

/** Décodé un message vocal (dataURL base64, ex. audio/webm) et l'écrit sur le disque.
 *  Retourne l'URL publique à stocker. */
export function saveAudio(dataUrl) {
  return writeBase64(dataUrl, "voice", AUDIO_TYPES, MAX_AUDIO_BYTES);
}

export function assertPhotos(photos) {
  for (const [field, value] of Object.entries(photos || {})) {
    if (value == null) continue;
    if (typeof value !== "string") throw new Error(`${field} : valeur invalide`);
  }
}