import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useApp } from "../store";
import { data } from "../data";
import { mediaUrl } from "../api";
import { useToast } from "../hooks/useToast";
import { onLive } from "../realtime";
import { startRecording, recordingSupported, type RecordingSession } from "../lib/recorder";
import type { Msg } from "../db/types";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function ThreadScreen() {
  const { offerId } = useParams();
  const user = useApp((s) => s.user);
  const showToast = useToast((s) => s.show);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Enregistrement vocal.
  const [recording, setRecording] = useState(false);
  const [recMs, setRecMs] = useState(0);
  const recSession = useRef<RecordingSession | null>(null);
  const recTimer = useRef<number>();

  const stickToBottom = useRef(true);

  // Marque la conversation comme lue : les messages entrants passent en "vu"
  // et les notifications de cette conversation disparaissent de la cloche.
  async function markRead() {
    if (!offerId) return;
    try {
      await data.markMessagesRead(offerId);
    } catch {
      /* hors ligne : le prochain polling rejouera l'accusé */
    }
  }

  useEffect(() => {
    if (!offerId) return;
    let cancelled = false;
    let freshLoaded = false;

    const load = async (follow: boolean) => {
      try {
        const fresh = await data.getMessages(offerId);
        if (cancelled) return;
        setMsgs(fresh);
        if (follow && stickToBottom.current) {
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      } catch {
        if (!freshLoaded) showToast("Conversation indisponible hors ligne");
      }
    };
    void load(true).finally(() => { freshLoaded = true; });
    void markRead();

    const poll = setInterval(() => {
      // On reste collé en bas sauf si l'utilisateur remonte pour lire l'historique.
      const el = bottomRef.current?.parentElement;
      stickToBottom.current = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true;
      void load(true);
      void markRead();
    }, 3000);

    // Temps réel : nouveau message ou accusé de lecture dans cette conversation.
    const off = onLive((ev) => {
      if (ev.offerId !== offerId) return;
      void load(true);
      if (ev.type === "message") void markRead();
    });

    return () => {
      cancelled = true;
      clearInterval(poll);
      off();
      if (recTimer.current) window.clearInterval(recTimer.current);
      if (recSession.current) {
        recSession.current.cancel();
        recSession.current = null;
      }
      // On quitte l'écran : confirme la lecture tant qu'on était dans la
      // conversation (les coches bleues restent à jour).
      void data.markMessagesRead(offerId).catch(() => {});
    };
  }, [offerId, user?.id]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !offerId) return;
    setBusy(true);
    try {
      await data.sendMessage(offerId, text);
      // Recharge les messages : l'id réel du serveur permet sa suppression.
      setMsgs(await data.getMessages(offerId));
      setText("");
      void markRead();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) {
      showToast(err.message || "Envoi impossible");
    } finally {
      setBusy(false);
    }
  }

  async function startVoice() {
    if (!offerId || recording) return;
    if (!recordingSupported()) {
      showToast("Enregistrement vocal non supporté sur cet appareil");
      return;
    }
    try {
      recSession.current = await startRecording();
      setRecording(true);
      setRecMs(0);
      recTimer.current = window.setInterval(() => setRecMs((s) => s + 1000), 1000);
    } catch (err: any) {
      showToast(
        err?.name === "NotAllowedError" || err?.code === 8
          ? "Micro refusé — autorise le micro dans les réglages"
          : err?.message || "Impossible de démarrer l'enregistrement"
      );
    }
  }

  async function sendVoice() {
    if (!offerId || !recSession.current) return;
    const session = recSession.current;
    recSession.current = null;
    if (recTimer.current) window.clearInterval(recTimer.current);
    setRecording(false);
    let record: { dataUrl: string; durationMs: number } | null = null;
    try {
      record = await session.stop();
    } catch (err: any) {
      session.cancel();
      showToast(err?.message || "Enregistrement annulé");
      return;
    }
    setBusy(true);
    try {
      await data.sendMessage(offerId, "", { audio: record.dataUrl, duration: record.durationMs });
      setMsgs(await data.getMessages(offerId));
      void markRead();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err: any) {
      showToast(err.message || "Envoi du vocal impossible");
    } finally {
      setBusy(false);
    }
  }

  function cancelVoice() {
    if (recTimer.current) window.clearInterval(recTimer.current);
    recSession.current?.cancel();
    recSession.current = null;
    setRecording(false);
    setRecMs(0);
  }

  async function remove(id: string) {
    if (!offerId) return;
    const prev = msgs;
    setMsgs(prev.filter((m) => m.id !== id));
    try {
      await data.deleteMessage(offerId, id);
      showToast("Message supprimé ✓");
    } catch {
      setMsgs(prev);
      showToast("Suppression impossible");
    }
  }

  return (
    <>
      <p className="section-label">Discussion</p>
      <div className="msg-thread">
        {msgs.length === 0 ? (
          <div className="empty" style={{ marginBottom: 8 }}>
            <p>Envoie ton premier message pour négocier.</p>
          </div>
        ) : (
          msgs.map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div className={`bubble ${mine ? "mine" : "theirs"}`} key={m.id}>
                {m.kind === "voice" ? (
                  <div className="voice-wrap">
                    <audio className="voice-audio" controls preload="metadata" src={mediaUrl(m.audio_url)} />
                    <span className="voice-dur">{mmss(m.duration_ms || 0)}</span>
                  </div>
                ) : (
                  <span className="bubble-body">{m.body}</span>
                )}
                {mine && (
                  <button className="msg-del" title="Supprimer ce message" onClick={() => void remove(m.id)}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6"/></svg>
                  </button>
                )}
                <div className="t">
                  {m.sender_name} · {new Date(m.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  {mine && <span className={`ticks ${m.seen ? "seen" : ""}`} title={m.seen ? "Lu" : "Envoyé"}>{m.seen ? "✓✓" : "✓"}</span>}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <form className="composer" onSubmit={send}>
        {recording ? (
          <div className="rec-bar">
            <span className="rec-dot" aria-hidden />
            <span className="rec-timer">{mmss(recMs)}</span>
            <span className="rec-hint">Enregistrement…</span>
            <button type="button" className="rec-cancel" onClick={cancelVoice} title="Annuler">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <button type="button" className="rec-send" onClick={() => void sendVoice()} disabled={busy} title="Envoyer le vocal">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
            </button>
          </div>
        ) : (
          <>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Écris un message…" />
            <button type="button" className="rec-mic" onClick={() => void startVoice()} title="Message vocal" disabled={busy}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 19v3"/></svg>
            </button>
            <button type="submit" disabled={busy || !text.trim()}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>
            </button>
          </>
        )}
      </form>
    </>
  );
}