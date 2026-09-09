const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const BASE = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;

// Base API normalisée (sans slash final), réutilisée par le canal temps réel.
export const API_BASE_URL = BASE;

// Origine du serveur déduite de la base API : indispensable pour résoudre les
// URLs relatives (/uploads/...) dans l'APK Capacitor, dont le webview n'est pas
// sur le même hôte.
const ORIGIN = BASE.replace(/\/api$/i, "");
export function mediaUrl(url?: string | null): string {
  if (!url) return "";
  if (/^https?:/i.test(url)) return url;
  return ORIGIN + url;
}

let token: string | null = localStorage.getItem("koodo_token");

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("koodo_token", t);
  else localStorage.removeItem("koodo_token");
}
export function getToken() {
  return token;
}

export function clearToken() {
  token = null;
  localStorage.removeItem("koodo_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as any) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // Timeout 30 s : un serveur qui dort (cold start Render, réseau lent) ne bloque
  // jamais l'écran — la demande échoue proprement et repart en file de synchro.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${BASE}${path}`, { ...options, headers, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Erreur ${res.status}`);
    }
    return res.json();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("Serveur injoignable — annonce mise dans la file d'envoi");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
