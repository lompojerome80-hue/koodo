import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useApp } from "../store";
import { data } from "../data";
import { useToast } from "../hooks/useToast";
import { onLive } from "../realtime";
import type { Msg } from "../db/types";

export default function ThreadScreen() {
  const { offerId } = useParams();
  const user = useApp((s) => s.user);
  const showToast = useToast((s) => s.show);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
                <span className="bubble-body">{m.body}</span>
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
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Écris un message…" />
        <button type="submit" disabled={busy || !text.trim()}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>
        </button>
      </form>
    </>
  );
}