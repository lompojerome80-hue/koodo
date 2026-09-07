const BASE = "/api";

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
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erreur ${res.status}`);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
