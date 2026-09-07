import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { useToast } from "../hooks/useToast";
import { data } from "../data";
import type { SupportThread, SupportMsg, AdminSupportThread } from "../db/types";

const ADMIN_PHONE = "+2260701000006";
const ADMIN_PHONE_INTL = "2260701000006";

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) +
    " " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  );
}

function bubbleClass(role: string, isMe: boolean): string {
  return isMe ? "bubble me" : "bubble them";
}

const IconPhone = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
);

const IconWhatsApp = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-1 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.9-1.7-2.2-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1 2.9 1.2 3.1c.2.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3z"/><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.9-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>
);

const IconBook = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
);

export default function HelpScreen() {
  const user = useApp((s) => s.user);
  const setTutorial = useApp((s) => s.setTutorial);
  const showToast = useToast((s) => s.show);
  const navigate = useNavigate();

  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMsg[]>([]);
  const [reply, setReply] = useState("");
  const [busyReply, setBusyReply] = useState(false);

  async function refreshThreads() {
    try {
      setThreads(await data.supportListThreads());
    } catch {}
  }

  useEffect(() => {
    void refreshThreads();
    const t = setInterval(refreshThreads, 15000);
    return () => clearInterval(t);
  }, []);

  async function createThread(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) {
      showToast("Donne un sujet et écris ton problème");
      return;
    }
    setBusy(true);
    try {
      const t = await data.supportCreateThread(subject.trim(), body.trim());
      showToast("Demande envoyée — le service technique va te répondre ✓");
      setSubject("");
      setBody("");
      setOpenId(t.id);
      await refreshThreads();
      await openThread(t.id);
    } catch (err: any) {
      showToast(err.message || "Envoi impossible");
    } finally {
      setBusy(false);
    }
  }

  async function openThread(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    try {
      setMessages(await data.supportListMessages(id));
    } catch {
      setMessages([]);
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!openId || !reply.trim()) return;
    setBusyReply(true);
    try {
      setMessages(await data.supportSendMessage(openId, reply.trim()));
      setReply("");
      await refreshThreads();
    } catch (err: any) {
      showToast(err.message || "Envoi impossible");
    } finally {
      setBusyReply(false);
    }
  }

  return (
    <div className="screen-pad">
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={() => navigate(-1)} disabled={busy}>
        ← Retour
      </button>
      <p className="eyebrow">Aide & support</p>
      <b style={{ fontSize: 17 }}>Demander de l'aide</b>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
        Un problème, une question ? Écris-nous : le service technique Koodo te répond directement ici.
      </p>

      <div className="info-card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <span className="title" style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--green-2)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              Service technique Koodo
            </span>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
              Appel ou WhatsApp — réponse rapide pendant les heures ouvrables.
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <a className="btn btn-ghost btn-sm" style={{ flex: 1 }} href={`tel:${ADMIN_PHONE}`}>{IconPhone} Appeler</a>
          <a
            className="btn btn-wa btn-sm"
            style={{ flex: 1 }}
            target="_blank"
            rel="noreferrer"
            href={`https://wa.me/${ADMIN_PHONE_INTL}?text=${encodeURIComponent("Bonjour Koodo, j'ai besoin d'aide.")}`}
          >
            {IconWhatsApp} WhatsApp
          </a>
          <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setTutorial(true)}>
            {IconBook} Revoir le tutoriel
          </button>
        </div>
      </div>

      <p className="section-label">Ouvrir une demande</p>
      <form className="form-card" onSubmit={createThread}>
        <div className="field">
          <label>Sujet</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Ex : Je n'arrive pas à régler mon dû"
            maxLength={120}
          />
        </div>
        <div className="field">
          <label>Décris ton problème</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Explique-nous ce qui se passe (cours, paiement, compte, dossier…)"
            rows={4}
            maxLength={3000}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: "100%", opacity: busy ? .7 : 1 }} disabled={busy}>
          {busy ? "Envoi…" : "Envoyer ma demande"}
        </button>
      </form>

      <p className="section-label">Mes demandes <span className="count">{threads.length}</span></p>
      {threads.length === 0 ? (
        <div className="empty">
          <div className="icon">💬</div>
          <p>Aucune demande pour l'instant.</p>
        </div>
      ) : (
        <div className="list">
          {threads.map((t) => (
            <div key={t.id} className="card hover press" style={{ padding: 0 }} onClick={() => void openThread(t.id)}>
              <div style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <b style={{ fontSize: 13 }}>{t.subject}</b>
                  <span className={`pill ${t.status === "answered" ? "open" : t.status === "closed" ? "" : "pending"}`}>
                    {t.status === "answered" ? "répondue" : t.status === "closed" ? "fermée" : "ouverte"}
                  </span>
                </div>
                <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  {t.last_message ? (
                    <>
                      <b style={{ color: "var(--ink)" }}>
                        {t.last_sender === "admin" ? "Service Koodo" : "Toi"} :
                      </b>{" "}
                      {t.last_message.slice(0, 80)}{t.last_message.length > 80 ? "…" : ""}
                    </>
                  ) : (
                    "En attente de réponse."
                  )}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--muted2)" }}>
                  {fmtDate(t.last_at)} · {t.message_count} message{t.message_count > 1 ? "s" : ""}
                </p>
              </div>

              {openId === t.id && (
                <div style={{ borderTop: "1px solid var(--border)", padding: 10 }} onClick={(e) => e.stopPropagation()}>
                  {messages.length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0" }}>Chargement…</p>
                  ) : (
                    <div className="chat">
                      {messages.map((m) => (
                        <div key={m.id} className={bubbleClass(m.sender_role, m.sender_role === "user")}>
                          <div className="bubble-head">
                            {m.sender_role === "admin" ? "Service Koodo" : "Toi"}
                          </div>
                          <div className="bubble-body">{m.body}</div>
                          <div className="bubble-time">{fmtDate(m.created_at)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={sendReply} style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <input
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Écris ta réponse…"
                      disabled={busyReply}
                    />
                    <button className="btn btn-primary btn-sm" style={{ opacity: busyReply ? .7 : 1 }} disabled={busyReply}>
                      {busyReply ? "…" : "Envoyer"}
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="empty" style={{ marginTop: 12 }}>
        <p style={{ fontSize: 11, color: "var(--muted)" }}>
          {user?.full_name} · {user?.phone}
        </p>
      </div>
    </div>
  );
}