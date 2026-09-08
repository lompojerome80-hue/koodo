import { API_BASE_URL } from "./api";
import { getToken } from "./api";

export interface LiveEvent {
  type: "message" | "seen";
  offerId: string;
}
type Listener = (ev: LiveEvent) => void;

const listeners = new Set<Listener>();
export function onLive(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function emit(ev: LiveEvent) {
  for (const l of [...listeners]) l(ev);
}

let session = 0;
let abort: AbortController | null = null;
let reconTimer: number | null = null;

// Canal temps réel (SSE) avec JWT en en-tête. Le navigateur/WebView doit
// supporter le streaming fetch ; sinon on retombe sur EventSource (jeton en
// query, accepté par le serveur en secours).
function parseChunk(buf: string): LiveEvent[] {
  const evs: LiveEvent[] = [];
  let blocks = buf.split("\n\n");
  for (const block of blocks) {
    const line = block.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim()) as LiveEvent;
      if (ev && (ev.type === "message" || ev.type === "seen") && ev.offerId) evs.push(ev);
    } catch {
      /* frame invalide, ignorée */
    }
  }
  return evs;
}

export function startRealtime() {
  const token = getToken();
  if (!token) return;
  stopRealtime();
  const mySession = ++session;
  const ac = new AbortController();
  abort = ac;
  const url = `${API_BASE_URL}/events`;

  const useEventSource = typeof EventSource !== "undefined" && !("ReadableStream" in window);

  void (async () => {
    let delay = 1000;
    while (mySession === session) {
      try {
        if (useEventSource) {
          const es = new EventSource(`${url}?token=${encodeURIComponent(token)}`);
          await new Promise<void>((resolve, reject) => {
            const onErr = () => { cleanup(); reject(new Error("sse-error")); };
            const cleanup = () => {
              es.removeEventListener("error", onErr);
              es.close();
            };
            es.onmessage = (e) => {
              try {
                const ev = JSON.parse(e.data) as LiveEvent;
                if (ev && ev.type && ev.offerId) emit(ev);
              } catch {}
            };
            es.addEventListener("error", onErr);
            es.onopen = () => {
              // connecté : on reste branché jusqu'à la fermeture du EventSource
            };
          });
          // Reçu une erreur (déconnecté) → boucle de reconnexion ci-dessous.
        } else {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            signal: ac.signal,
          });
          if (!res.ok || !res.body) throw new Error(`sse ${res.status}`);
          delay = 1000;
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const evs = parseChunk(buf);
            buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
            for (const e of evs) emit(e);
          }
        }
      } catch {
        if (mySession !== session) return; // arrêté
      }
      if (mySession !== session) return;
      await new Promise((r) => { reconTimer = window.setTimeout(r, delay); reconTimer = null; });
      delay = Math.min(delay * 2, 15000);
    }
  })();
}

export function stopRealtime() {
  session++;
  if (reconTimer !== null) {
    clearTimeout(reconTimer);
    reconTimer = null;
  }
  abort?.abort();
  abort = null;
}