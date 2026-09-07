import { useEffect, useState, useRef, type RefObject } from "react";
import { useApp } from "../store";
import { useToast } from "../hooks/useToast";
import { requestLocation } from "../geo";
import { data } from "../data";
import { pickPhoto } from "../components/CourierDossierFields";
import { refreshNotifications } from "../notif";
import type { CourseDelivery, CourierDues, User } from "../types";
import { TRANSPORTS } from "../types";

const STATUS_LABEL: Record<string, string> = {
  open: "🟡 Dispo — livreur à trouver",
  accepted: "🔵 Course acceptée — récupération",
  picked_up: "🟣 Colis récupéré — en livraison",
  done: "✅ Livrée",
  cancelled: "✖️ Annulée",
};

function formatF(n: number): string {
  return (Number(n) || 0).toLocaleString("fr-FR");
}

function StatusPill({ status }: { status: string }) {
  const cls = status === "done" ? "pill open" : status === "accepted" || status === "picked_up" ? "pill pending" : status === "cancelled" ? "pill sold" : "pill pending";
  return <span className={cls} style={{ fontSize: 9 }}>{STATUS_LABEL[status] || status}</span>;
}

function CodeChip({ label, code }: { label: string; code?: string }) {
  if (!code) return null;
  return (
    <div className="code-chip">
      <small>{label}</small>
      <b className="font-mono">{code}</b>
    </div>
  );
}

/** Dossier du livreur : localité, déplacement, photo + pièce d'identité.
 *  Les photos de la pièce ne peuvent pas être supprimées, seulement remplacées. */
function DossierCard({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const showToast = useToast((s) => s.show);
  const complete = !!(user.locality && user.transport && user.selfie && user.id_front && user.id_back);
  const [edit, setEdit] = useState(!complete);
  const [loc, setLoc] = useState(user?.locality || "");
  const [transport, setTransport] = useState(user?.transport || "");
  const [selfie, setSelfie] = useState(user?.selfie || "");
  const [idFront, setIdFront] = useState(user?.id_front || "");
  const [idBack, setIdBack] = useState(user?.id_back || "");
  const [busy, setBusy] = useState(false);
  const selfieRef = useRef<HTMLInputElement>(null);
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  async function setPhoto(file: File | undefined, field: "selfie" | "front" | "back") {
    if (!file) return;
    try {
      const url = await pickPhoto(file, field === "selfie" ? 700 : 1100);
      if (field === "selfie") setSelfie(url);
      else if (field === "front") setIdFront(url);
      else setIdBack(url);
    } catch (err: any) {
      showToast(err.message || "Photo impossible");
    }
  }

  function fileInput(field: "selfie" | "front" | "back", ref: RefObject<HTMLInputElement>) {
    return (
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture={field === "selfie" ? "user" : "environment"}
        style={{ display: "none" }}
        onChange={(e) => setPhoto(e.target.files?.[0], field)}
      />
    );
  }

  function photoBtn(src: string, label: string, ref: RefObject<HTMLInputElement>) {
    return (
      <button type="button" className="dossier-photo" onClick={() => ref.current?.click()} title={label}>
        {src ? <img src={src} alt={label} /> : <span>{label}<br />📷</span>}
      </button>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!loc || !transport) return showToast("Localité et moyen de déplacement requis");
    if (!complete && !(selfie && idFront && idBack)) return showToast("Ajoute ta photo et ta pièce d'identité (recto + verso)");
    setBusy(true);
    try {
      const u = await data.updateCourierDossier({ locality: loc, transport, selfie, id_front: idFront, id_back: idBack });
      onSaved(u);
      setEdit(false);
      showToast("Dossier enregistré ✓");
    } catch (err: any) {
      showToast(err.message || "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <b style={{ fontSize: 13 }}>💼 Mon dossier livreur</b>
        {user.doc_status ? (
          <span className={`pill ${user.doc_status === "verified" ? "open" : "pending"}`} style={{ fontSize: 9 }}>
            {user.doc_status === "verified" ? "Pièce vérifiée ✓" : "En cours de vérification"}
          </span>
        ) : null}
      </div>
      {!complete && (
        <p className="error-box" style={{ margin: "8px 0 0" }}>
          Dossier incomplet — tu ne peux pas encore accepter de course.
        </p>
      )}
      <p style={{ fontSize: 11, color: "var(--muted2)", margin: "4px 0 8px" }}>
        Tes informations servent à confirmer ton identité lors d'un litige. Tes photos de pièce ne sont jamais montrées
        aux clients — seuls ton nom, ta photo et ton moyen de déplacement circulent.
      </p>

      {edit ? (
        <form onSubmit={save}>
          <div className="field-row">
            <div className="field">
              <label>Localité d'exercice *</label>
              <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Ex : Karpala, Ouagadougou" />
            </div>
            <div className="field">
              <label>Moyen de déplacement *</label>
              <select value={transport} onChange={(e) => setTransport(e.target.value)}>
                <option value="">— Choisis —</option>
                {TRANSPORTS.map((t) => <option key={t.label} value={t.label}>{t.emoji} {t.label}</option>)}
              </select>
            </div>
          </div>
          <p className="section-label" style={{ margin: "6px 0 4px", fontSize: 11 }}>
            {complete ? "Photo et pièce d'identité (remplace pour changer — impossible à supprimer)" : "Ta photo et ta pièce d'identité (recto + verso) *"}
          </p>
          <div className="photo-row">
            {photoBtn(selfie, "Ta photo", selfieRef)}
            {photoBtn(idFront, "CNI recto", frontRef)}
            {photoBtn(idBack, "CNI verso", backRef)}
          </div>
          {fileInput("selfie", selfieRef)}
          {fileInput("front", frontRef)}
          {fileInput("back", backRef)}
          <button type="submit" className="btn btn-primary btn-sm" style={{ marginTop: 10, opacity: busy ? .7 : 1 }} disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </form>
      ) : (
        <>
          <p style={{ fontSize: 12, margin: "6px 0 0" }}>
            📍 {user.locality}{user.transport ? ` · ${TRANSPORTS.find((t) => t.label === user.transport)?.emoji || "🛵"} ${user.transport}` : ""}
          </p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setEdit(true)}>
            Modifier mes informations
          </button>
        </>
      )}
    </div>
  );
}

/** Carte d'une course, avec l'action correspondant à son statut. */
function RunnerCard({ d, onChanged, dossierOk }: { d: CourseDelivery; onChanged: () => void; dossierOk: boolean }) {
  const showToast = useToast((s) => s.show);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setCode(""); }, [d.status]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      showToast(ok);
      onChanged();
      refreshNotifications().catch(() => {});
    } catch (err: any) {
      showToast(err.message || "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card deliver-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 14 }}>{d.title}</b>
          {d.package && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>📦 {d.package}</p>}
          <p style={{ margin: "6px 0 0", fontSize: 12 }}>
            {d.seller_label || d.seller_name} <span style={{ color: "var(--muted2)" }}>→</span> {d.buyer_label}
          </p>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <b className="font-mono" style={{ fontSize: 14 }}>{formatF(d.price_fee)} F</b>
          {d.distanceKm != null && <p style={{ margin: 0, fontSize: 10, color: "var(--muted)" }}>📍 {d.distanceKm} km</p>}
        </div>
      </div>

      {d.status === "open" && (
        <button
          className="btn btn-primary"
          style={{ marginTop: 10 }}
          disabled={busy || !dossierOk}
          onClick={() => run(() => data.acceptDelivery(d.id), "Course acceptée 🛵")}
        >
          {busy ? "…" : !dossierOk ? "Complète ton dossier pour accepter" : "Accepter la course"}
        </button>
      )}

      {d.status === "accepted" && (
        <div style={{ marginTop: 10 }}>
          <CodeChip label="Prix de la course (tu touches tout)" code={`${formatF(d.price_fee)} F`} />
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0" }}>
            Récupère le colis chez <b>{d.seller_label || d.seller_name}</b>. Le vendeur te lit son code de récupération.
            À la livraison, Koodo prélève sa commission de 10 % (ajoutée à ton dû du jour).
          </p>
          <input className="pin-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Code vendeur" inputMode="numeric" />
          <button className="btn btn-green" style={{ marginTop: 8 }} disabled={busy || code.length < 6} onClick={() => run(() => data.pickupDelivery(d.id, code), "Colis récupéré ✓")}>
            {busy ? "…" : "Confirmer la récupération"}
          </button>
        </div>
      )}

      {d.status === "picked_up" && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 8px" }}>
            Livre à <b>{d.buyer_label}</b>. L'acheteur te communique son code de livraison.
          </p>
          <CodeChip label="Remise le colis → tu touches" code={`${formatF(d.price_fee)} F`} />
          <input className="pin-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Code acheteur" inputMode="numeric" />
          <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy || code.length < 6} onClick={() => run(() => data.completeDelivery(d.id, code), `Course livrée ✓ — tu touches ${formatF(d.price_fee)} F (Koodo prélève 10 % de commission)`)}>
            {busy ? "…" : "Confirmer la livraison"}
          </button>
          <p style={{ fontSize: 11, color: "var(--muted2)", margin: "6px 0 0" }}>
            La commission de {formatF(Math.round(d.price_fee * 0.1))} F (10 %) est prélevée par Koodo et ajoutée à ton dû du jour.
          </p>
        </div>
      )}

      {d.status === "done" && (
        <p style={{ fontSize: 12, color: "var(--green-2)", margin: "8px 0 0" }}>
          Livré le {d.delivered_at ? new Date(d.delivered_at).toLocaleDateString("fr-FR") : "aujourd'hui"} — tu as touché{" "}
          <b className="font-mono">{formatF(d.price_fee)} F</b> ; Koodo a ajouté sa commission de 10 % ({formatF(Math.round(d.price_fee * 0.1))} F) à ton dû du jour.
        </p>
      )}

      {d.status === "accepted" && d.delivery_code && (
        <CodeChip label="Code que l'acheteur donnera" code={d.delivery_code} />
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10, justifyContent: "space-between", alignItems: "center" }}>
        <StatusPill status={d.status} />
        {d.courier_name && <small style={{ color: "var(--muted2)" }}>🛵 {d.courier_name}</small>}
      </div>
    </div>
  );
}

/** Carte côté vendeur : montre les codes à transmettre et l'avancement. */
function SellerCard({ d, onChanged }: { d: CourseDelivery; onChanged: () => void }) {
  const showToast = useToast((s) => s.show);

  return (
    <div className="card deliver-card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 14 }}>{d.title}</b>
          {d.package && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>📦 {d.package}</p>}
          <p style={{ margin: "6px 0 0", fontSize: 12 }}>
            {d.seller_label || d.seller_name} <span style={{ color: "var(--muted2)" }}>→</span> {d.buyer_label}
          </p>
        </div>
        <b className="font-mono" style={{ fontSize: 14, flexShrink: 0 }}>{formatF(d.price_fee)} F</b>
      </div>

      {(d.status === "open" || d.status === "accepted") && (
        <CodeChip label="Code à donner au livreur (récupération)" code={d.pickup_code} />
      )}
      {(d.status === "accepted" || d.status === "picked_up") && (
        <CodeChip label="Code à communiquer à l'acheteur (livraison)" code={d.delivery_code} />
      )}

      {(d.status === "accepted" || d.status === "picked_up" || d.status === "done") && (
        <div className="courier-id" style={{ marginTop: 8 }}>
          <div className="avatar">
            {d.courier_photo ? <img src={d.courier_photo} alt="Livreur" /> : <span>🛵</span>}
          </div>
          <div>
            <b style={{ fontSize: 12 }}>{d.courier_name || "Livreur"}</b>
            <small style={{ color: "var(--muted2)" }}>
              {d.courier_transport ? `${d.courier_transport} · ` : ""}{d.courier_locality || ""}
              {d.courier_verified ? " · identité vérifiée ✓" : ""}
            </small>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center", justifyContent: "space-between" }}>
        <StatusPill status={d.status} />
        <div style={{ display: "flex", gap: 6 }}>
          {(d.status === "open" || d.status === "accepted") && (
            <button
              className="btn btn-danger-ghost btn-sm"
              onClick={async () => {
                try {
                  await data.cancelDelivery(d.id);
                  showToast("Course annulée");
                  onChanged();
                } catch (err: any) {
                  showToast(err.message || "Annulation impossible");
                }
              }}
            >
              Annuler
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CourierScreen() {
  const user = useApp((s) => s.user);
  const geo = useApp((s) => s.geo);
  const storeUser = useApp((s) => s.setUser);
  const showToast = useToast((s) => s.show);
  const isCourier = user?.role === "courier";
  const dossierOk = isCourier && !!user && !!user.locality && !!user.transport && !!user.selfie && !!user.id_front && !!user.id_back;

  const [open, setOpen] = useState<CourseDelivery[]>([]);
  const [mine, setMine] = useState<CourseDelivery[]>([]);
  const [dues, setDues] = useState<CourierDues | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", package: "", buyer_label: "", buyer_phone: "", price_fee: "" });
  const [creating, setCreating] = useState(false);
  const [busySettle, setBusySettle] = useState(false);
  const [receipt, setReceipt] = useState("");
  const receiptRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      if (isCourier) {
        const g = geo;
        const [o, m, d] = await Promise.all([
          data.listOpenDeliveries(g?.lat ?? null, g?.lng ?? null),
          data.listMyDeliveries(),
          data.courierDues(),
        ]);
        setOpen(o);
        setMine(m);
        setDues(d);
      } else {
        setMine(await data.listMyDeliveries());
      }
    } catch {
      showToast("Impossible de charger les courses");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { setLoading(true); void load(); }, [user?.id]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.buyer_label || !Number(form.price_fee)) {
      return showToast("Titre, destination et prix requis");
    }
    setCreating(true);
    try {
      let g = geo;
      if (!g?.lat) g = await requestLocation();
      await data.createDelivery({
        title: form.title,
        package: form.package || undefined,
        buyer_label: form.buyer_label,
        buyer_phone: form.buyer_phone || undefined,
        price_fee: Number(form.price_fee),
        seller_lat: g?.lat ?? null,
        seller_lng: g?.lng ?? null,
        seller_label: g?.label && g.label !== "…" ? g.label : user?.village || user?.region || undefined,
      });
      showToast("Course publiée — un livreur proche sera notifié 🛵");
      setForm({ title: "", package: "", buyer_label: "", buyer_phone: "", price_fee: "" });
      await load();
    } catch (err: any) {
      showToast(err.message || "Impossible de créer la course");
    } finally {
      setCreating(false);
    }
  }

  const mineOpen = mine.filter((d) => ["open", "accepted"].includes(d.status));

  useEffect(() => {
    if ((isCourier && dues?.blocked) || (!isCourier && mineOpen.length === 0 && mine.length === 0 && !loading)) {
      showToast("Pense au dû du soir — règle tes commissions avant 00H");
    }
  }, []);

  return (
    <>
      {isCourier && !loading && dues && (
        <div className={dues.blocked ? "info-card blocked-banner" : "info-card due-banner"}>
          {dues.blocked ? (
            <>
              <p style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--alert)" }}>🔴 Compte bloqué</p>
              <p style={{ margin: "0 0 8px", fontSize: 12 }}>{dues.blockedReason}</p>
              {dues.pendingPayment ? (
                <div style={{ fontSize: 12, color: "var(--ink)" }}>
                  <p style={{ margin: "0 0 4px" }}>⏳ Paiement de <b>{formatF(dues.pendingPayment.amount)} F</b> envoyé
                    {dues.pendingPayment.hasReceipt ? " avec ta capture d'écran" : ""} — en attente de vérification par l'admin.</p>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>Ton compte sera débloqué dès la confirmation.</p>
                </div>
              ) : (
                <>
                  <label style={{ display: "block", fontSize: 12, margin: "4px 0 8px", cursor: "pointer" }}>
                    <span style={{ textDecoration: "underline", color: "var(--ink)" }}>
                      {receipt ? "Changer la capture" : "Joindre la capture du paiement (optionnel)"}
                    </span>
                    <input
                      ref={receiptRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          setReceipt(await pickPhoto(f, 900));
                        } catch {
                          showToast("Capture impossible");
                        }
                      }}
                    />
                  </label>
                  {receipt && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
                      <img src={receipt} alt="capture du paiement" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8 }} />
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        Capture jointe — envoyée à Koodo pour validation.
                      </span>
                    </div>
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ width: "100%", opacity: busySettle ? .7 : 1 }}
                    disabled={busySettle}
                    onClick={async () => {
                      setBusySettle(true);
                      try {
                        const d = await data.settleDues(receipt || undefined);
                        setDues(d);
                        refreshNotifications().catch(() => {});
                        showToast(
                          d.pendingPayment
                            ? "Paiement envoyé — en attente de vérification admin ✓"
                            : "Dû réglé — compte débloqué ✓"
                        );
                      } catch (err: any) {
                        showToast(err.message || "Règlement impossible");
                      } finally {
                        setBusySettle(false);
                      }
                      await load();
                    }}
                  >
                    {busySettle ? "Envoi…" : `Régler mon dû (${formatF(dues.totalUnpaid)} F)`}
                  </button>
                </>
              )}
            </>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div>
                <b>💰 Dû du jour : {formatF(dues.dueToday)} F</b>
                {dues.totalUnpaid > 0 && <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>sans dette en retard</p>}
              </div>
              <span className="pill open">À régler avant 00H</span>
            </div>
          )}
        </div>
      )}

      {isCourier && user && user.doc_status !== "verified" && (
        <div style={{ marginTop: 12 }}>
          <DossierCard user={user} onSaved={storeUser} />
        </div>
      )}

      <div className="courier-hero">
        <div>
          <p className="eyebrow">Koodo Livraisons</p>
          <b style={{ fontSize: 16 }}>{isCourier ? "Trouve des courses près de toi" : "Confie ta commande à un livreur"}</b>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>
            {isCourier
              ? "Le vendeur fixe le prix et tu touches la course à la livraison. Koodo prélève 10 % de commission sur chaque course."
              : "Le livreur récupère chez toi et remet à l'acheteur. Le paiement est sécurisé."}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 100, marginTop: 12 }} />
      ) : isCourier ? (
        <>
          <p className="section-label">Courses disponibles <span className="count">{open.length}</span></p>
          {open.length === 0 ? (
            <div className="empty">
              <div className="icon">🛵</div>
              <p>Aucune course ouverte pour le moment.</p>
              <p>Les vendeurs à proximité notifient les livreurs quand ils ont une commande.</p>
            </div>
          ) : (
            <div className="list">
              {open.map((d) => <RunnerCard key={d.id} d={d} onChanged={load} dossierOk={dossierOk} />)}
            </div>
          )}

          <p className="section-label">Mes courses <span className="count">{mine.length}</span></p>
          {mine.length === 0 ? (
            <div className="empty">
              <div className="icon">🧭</div>
              <p>Tu n'as pas encore de course.</p>
              <p>Accepte une course disponible ci-dessus.</p>
            </div>
          ) : (
            <div className="list">
              {mine.map((d) => <RunnerCard key={d.id} d={d} onChanged={load} dossierOk={dossierOk} />)}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="section-label">Lancer une course</p>
          <form className="form-card" onSubmit={create}>
            <div className="field">
              <label>Intitulé *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex : Livraison de ma récolte de tomates" />
            </div>
            <div className="field">
              <label>Contenu du colis</label>
              <input value={form.package} onChange={(e) => setForm({ ...form, package: e.target.value })} placeholder="Ex : 2 sacs de 50 kg" />
            </div>
            <div className="field">
              <label>Destination (point de remise) *</label>
              <input value={form.buyer_label} onChange={(e) => setForm({ ...form, buyer_label: e.target.value })} placeholder="Ex : Marché Rood Woko, Ouagadougou" />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Téléphone de l'acheteur</label>
                <input value={form.buyer_phone} onChange={(e) => setForm({ ...form, buyer_phone: e.target.value })} placeholder="+226 70…" inputMode="tel" />
              </div>
              <div className="field">
                <label>Prix de la course (F) *</label>
                <input type="number" min="100" value={form.price_fee} onChange={(e) => setForm({ ...form, price_fee: e.target.value })} placeholder="ex : 2000" />
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={creating} style={{ opacity: creating ? .7 : 1 }}>
              {creating ? "Publication…" : "Trouver un livreur proche 🛵"}
            </button>
            <p style={{ fontSize: 11, color: "var(--muted2)", margin: "8px 0 0", textAlign: "center" }}>
              Le livreur touche la course à la livraison. La commission de 10 % est versée à Koodo.
            </p>
          </form>

          <p className="section-label">Mes courses <span className="count">{mine.length}</span></p>
          {mine.length === 0 ? (
            <div className="empty">
              <div className="icon">🛵</div>
              <p>Aucune course pour l'instant.</p>
              <p>Crée une course ci-dessus dès qu'une commande est prête à partir.</p>
            </div>
          ) : (
            <div className="list">
              {mine.map((d) => <SellerCard key={d.id} d={d} onChanged={load} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}