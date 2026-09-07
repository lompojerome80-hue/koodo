import { useApp } from "./store";
import type { GeoState } from "./store";

const LS = "koodo_pos";

export function cachedLocation(): GeoState | null {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return null;
    const g = JSON.parse(raw) as GeoState;
    if (!g?.lat || !g?.lng) return null;
    return g;
  } catch {
    return null;
  }
}

function save(g: GeoState) {
  try {
    localStorage.setItem(LS, JSON.stringify(g));
  } catch { /* plein */ }
}

async function labelFor(lat: number, lng: number): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&zoom=16&accept-language=fr`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } }
    );
    clearTimeout(t);
    if (!res.ok) throw new Error("geo");
    const j = await res.json();
    const a = j?.address || {};
    const label =
      a.village || a.town || a.city || a.county || a.suburb || a.district || (a.state ? `près de ${a.state}` : null);
    if (label) return label;
  } catch { /* indisponible hors ligne */ }
  return "Votre position";
}

/**
 * Demande l'accès à la localisation (le navigateur affiche la demande de
 * confirmation). Retourne null si refusé/indisponible.
 */
export function requestLocation(force = false): Promise<GeoState | null> {
  const cached = cachedLocation();
  if (cached && !force) {
    useApp.getState().setGeo(cached);
    return Promise.resolve(cached);
  }
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    useApp.getState().setGeoTrying(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const g: GeoState = {
          lat: +pos.coords.latitude.toFixed(4),
          lng: +pos.coords.longitude.toFixed(4),
          label: "…",
          ts: Date.now(),
        };
        useApp.getState().setGeo(g);
        g.label = await labelFor(g.lat, g.lng);
        save(g);
        useApp.getState().setGeo({ ...g });
        useApp.getState().setGeoTrying(false);
        resolve(g);
      },
      () => {
        useApp.getState().setGeoTrying(false);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
    );
  });
}

export function restoreLocation() {
  const cached = cachedLocation();
  if (cached) useApp.getState().setGeo(cached);
}

export function applyGeoToField(field: "latlng" | "lat" | "lng"): string {
  const g = useApp.getState().geo;
  if (!g) return "";
  if (field === "latlng") return `${g.lat}, ${g.lng}`;
  return field === "lat" ? String(g.lat) : String(g.lng);
}

/** Partage une position (déjà consentie) avec la barre du haut et le cache. */
export async function persistGeo(lat: number, lng: number, immediate = false): Promise<GeoState> {
  const g: GeoState = { lat: +lat.toFixed(4), lng: +lng.toFixed(4), label: immediate ? "Votre position" : "…", ts: Date.now() };
  useApp.getState().setGeo(g);
  if (immediate) return g;
  g.label = await labelFor(g.lat, g.lng);
  save(g);
  useApp.getState().setGeo({ ...g });
  return g;
}