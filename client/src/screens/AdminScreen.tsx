import { useEffect, useState } from "react";
import { useApp } from "../store";
import { useToast } from "../hooks/useToast";
import { data } from "../data";
import type { AdminCourier, AdminPayment } from "../types";
import type { AdminSupportThread, SupportMsg, AdminReport } from "../db/types";

function fmtF(n: number): string {
  return (Number(n) || 0).toLocaleString("fr-FR");
}

export default function AdminScreen() {
  const user = useApp((s) => s.user);
  const showToast = useToast((s) => s.show);
  const [couriers, setCouriers] = useState<AdminCourier[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [support, setSupport] = useState<AdminSupportThread[]>([]);
  const [openSupportId, setOpenSupportId] = useState<string | null>(null);
  const [supportMsgs, setSupportMsgs] = useState<SupportMsg[]>([]);
  const [supportReply, setSupportReply] = useState<string>("");
  const [busyReply, setBusyReply] = useState(false);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [busyReport, setBusyReport] = useState<string | null>(null);

  async function load() {
    try {
      setCouriers(await data.adminListCouriers());
    } catch {
      setCouriers([]);
    }
    try {
      setPayments(await data.adminListPayments());
    } catch {
      setPayments([]);
    }
    try {
      setSupport(await data.adminSupportList());
    } catch {
      setSupport([]);
    }
    try {
      setReports((await data.adminListReports()).filter((r) => r.status === "open"));
    } catch {
      setReports([]);
    }
  }

  useEffect(() => {
    void load();
  }, [user?.id]);

  if (user?.role !== "admin") {
    return (
      <div className="screen-pad">
        <div className="empty">
          <div className="icon">🛡️</div>
          <p>Accès réservé à l'administration Koodo.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-pad">
      <p className="eyebrow">Console admin</p>
      <b style={{ fontSize: 17 }}>Pilotage Koodo</b>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
        Vérifie les dossiers livreurs et confirme les règlements avec capture.
      </p>

      <p className="section-label">Règlements à confirmer <span className="count">{payments.length}</span></p>
      {payments.length === 0 ? (
        <div className="empty" style={{ padding: "14px 12px" }}>
          <div className="icon" style={{ fontSize: 22 }}>💸</div>
          <p>Aucun règlement en attente.</p>
        </div>
      ) : (
        <div className="list">
          {payments.map((p) => (
            <div key={p.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b style={{ fontSize: 13 }}>{p.full_name || "—"}</b>
                <span className="pill pending">en attente</span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>
                {p.phone} · {p.created_at || ""}
              </p>
              <p style={{ margin: "6px 0" }}><b>{fmtF(p.amount)} F</b></p>
              <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--muted)" }}>
                En confirmant, le dû de {p.full_name || "ce livreur"} repasse à zéro et son compte est débloqué.
              </p>
              {p.receipt && (
                <div style={{ margin: "0 0 8px" }}>
                  <img src={p.receipt} alt="capture du paiement" style={{ width: "100%", maxHeight: 180, objectFit: "contain", borderRadius: 10, background: "#f5f1e8" }} />
                </div>
              )}
              <button
                className="btn btn-primary btn-sm"
                style={{ width: "100%", opacity: busyId === p.id ? .7 : 1 }}
                disabled={busyId === p.id}
                onClick={async () => {
                  setBusyId(p.id);
                  try {
                    await data.adminConfirmPayment(p.id);
                    showToast("Règlement confirmé — compte débloqué ✓");
                    await load();
                  } catch (err: any) {
                    showToast(err.message || "Confirmation impossible");
                  } finally {
                    setBusyId(null);
                  }
                }}
              >
                {busyId === p.id ? "Confirmation…" : "Confirmer le règlement"}
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="section-label">Dossiers livreurs <span className="count">{couriers.length}</span></p>
      <div className="list">
        {couriers.map((c) => (
          <div key={c.id} className="card">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {c.selfie ? (
                <img src={c.selfie} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 999 }} />
              ) : (
                <span style={{ width: 44, height: 44, borderRadius: 999, background: "var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>🛵</span>
              )}
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13 }}>{c.full_name}</b>
                <p style={{ margin: "1px 0 0", fontSize: 11, color: "var(--muted)" }}>
                  {c.phone}
                  {c.locality ? ` · 📍 ${c.locality}` : ""}
                  {c.transport ? ` · ${c.transport}` : ""}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>
                  restant : <b>{fmtF(c.totalUnpaid)} F</b>
                </p>
              </div>
              {c.doc_status === "verified" ? (
                <span className="pill open">Pièce vérifiée ✓</span>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busyId === c.id}
                  style={{ opacity: busyId === c.id ? .7 : 1 }}
                  onClick={async () => {
                    setBusyId(c.id);
                    try {
                      await data.adminVerifyCourier(c.id);
                      showToast(`Pièce de ${c.full_name} vérifiée ✓`);
                      await load();
                    } catch (err: any) {
                      showToast(err.message || "Vérification impossible");
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  {busyId === c.id ? "…" : "Vérifier"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="section-label">Signalements d'annonces <span className="count">{reports.length}</span></p>
      <p style={{ fontSize: 11, color: "var(--muted)", margin: "-6px 2px 8px" }}>
        Un membre signale une annonce. « Retirer » la masque du marché, « Ignorer » la classe sans suite.
      </p>
      {reports.length === 0 ? (
        <div className="empty" style={{ padding: "14px 12px" }}>
          <div className="icon" style={{ fontSize: 22 }}>🚩</div>
          <p>Aucun signalement en attente.</p>
        </div>
      ) : (
        <div className="list">
          {reports.map((r) => (
            <div key={r.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b style={{ fontSize: 13 }}>
                  {r.emoji} {r.crop_name} · {fmtF(r.quantity)} kg
                </b>
                <span className="pill pending">{r.status}</span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                🚩 <b>{r.reason}</b>
                {r.note && <span style={{ color: "var(--muted)" }}> — {r.note}</span>}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>
                👤 Vendeur : <b style={{ color: "var(--ink)" }}>{r.seller_name}</b> {r.seller_phone} · {fmtF(r.unit_price)} F/kg
              </p>
              <p style={{ margin: "2px 0 6px", fontSize: 11, color: "var(--muted2)" }}>
                Signalé par {r.reporter_name} ({r.reporter_phone}) le {r.created_at || ""}
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn btn-danger btn-sm"
                  style={{ flex: 1, opacity: busyReport === r.id ? .7 : 1 }}
                  disabled={busyReport === r.id}
                  onClick={async () => {
                    setBusyReport(r.id);
                    try {
                      await data.adminHandleReport(r.id, "remove");
                      showToast("Annonce retirée du marché ✓");
                      await load();
                    } catch (err: any) {
                      showToast(err.message || "Action impossible");
                    } finally {
                      setBusyReport(null);
                    }
                  }}
                >
                  {busyReport === r.id ? "…" : "Retirer l'annonce"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ flex: 1, opacity: busyReport === r.id ? .7 : 1 }}
                  disabled={busyReport === r.id}
                  onClick={async () => {
                    setBusyReport(r.id);
                    try {
                      await data.adminHandleReport(r.id, "ignore");
                      showToast("Signalement classé sans suite");
                      await load();
                    } catch (err: any) {
                      showToast(err.message || "Action impossible");
                    } finally {
                      setBusyReport(null);
                    }
                  }}
                >
                  {busyReport === r.id ? "…" : "Ignorer"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="section-label">Demandes d'aide <span className="count">{support.length}</span></p>
      <p style={{ fontSize: 11, color: "var(--muted)", margin: "-6px 2px 8px" }}>
        Réponds aux utilisateurs : ta réponse arrive directement dans leur écran « Demander de l'aide ».
      </p>
      {support.length === 0 ? (
        <div className="empty" style={{ padding: "14px 12px" }}>
          <div className="icon" style={{ fontSize: 22 }}>💬</div>
          <p>Aucune demande pour l'instant.</p>
        </div>
      ) : (
        <div className="list">
          {support.map((t) => {
            const open = openSupportId === t.id;
            return (
              <div
                key={t.id}
                className="card hover press"
                style={{ padding: 0 }}
                onClick={async () => {
                  if (open) {
                    setOpenSupportId(null);
                    return;
                  }
                  setOpenSupportId(t.id);
                  try {
                    setSupportMsgs(await data.adminSupportMessages(t.id));
                  } catch {
                    setSupportMsgs([]);
                  }
                }}
              >
                <div style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 13 }}>{t.subject}</b>
                      <p style={{ margin: "1px 0 0", fontSize: 11, color: "var(--muted)" }}>
                        {t.full_name} · {t.phone}
                      </p>
                    </div>
                    <span className={`pill ${t.status === "answered" ? "open" : t.status === "closed" ? "" : "pending"}`}>
                      {t.status === "answered" ? "répondue" : t.status === "closed" ? "fermée" : "ouverte"}
                    </span>
                  </div>
                  <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--muted)" }}>
                    {t.last_message ? (
                      <>
                        <b style={{ color: "var(--ink)" }}>{t.last_sender === "admin" ? "Service Koodo" : t.full_name.split(" ")[0]} :</b>{" "}
                        {t.last_message.slice(0, 90)}{t.last_message.length > 90 ? "…" : ""}
                      </>
                    ) : (
                      "En attente de message."
                    )}
                  </p>
                  <p style={{ margin: "3px 0 0", fontSize: 10, color: "var(--muted2)" }}>
                    {t.created_at || ""} · {t.message_count} message{t.message_count > 1 ? "s" : ""}
                  </p>
                </div>

                {open && (
                  <div style={{ borderTop: "1px solid var(--border)", padding: 10 }} onClick={(e) => e.stopPropagation()}>
                    {supportMsgs.length === 0 ? (
                      <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0" }}>Chargement…</p>
                    ) : (
                      <div className="chat">
                        {supportMsgs.map((m) => (
                          <div key={m.id} className={m.sender_role === "admin" ? "bubble me" : "bubble them"}>
                            <div className="bubble-head">
                              {m.sender_role === "admin" ? "Service Koodo" : t.full_name}
                            </div>
                            <div className="bubble-body">{m.body}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!supportReply.trim()) return;
                        setBusyReply(true);
                        try {
                          await data.adminSupportReply(t.id, supportReply.trim());
                          setSupportReply("");
                          setSupportMsgs(await data.adminSupportMessages(t.id));
                          showToast("Réponse envoyée ✓");
                          await load();
                        } catch (err: any) {
                          showToast(err.message || "Envoi impossible");
                        } finally {
                          setBusyReply(false);
                        }
                      }}
                      style={{ display: "flex", gap: 6, marginTop: 8 }}
                    >
                      <input value={supportReply} onChange={(e) => setSupportReply(e.target.value)} placeholder={`Répondre à ${t.full_name.split(" ")[0]}…`} disabled={busyReply} />
                      <button className="btn btn-primary btn-sm" style={{ opacity: busyReply ? .7 : 1 }} disabled={busyReply}>
                        {busyReply ? "…" : "Envoyer"}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}