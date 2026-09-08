import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { useToast } from "../hooks/useToast";
import { data, dbMode } from "../data";
import { useCart } from "../cart";
import { onLive } from "../realtime";
import { refreshNotifications } from "../notif";
import { requestLocation } from "../geo";
import { LANGS, t } from "../i18n";
import type { Crop, Alert, CourierDues, SellerOrder, NearbyCourier } from "../types";
import { TRANSPORTS } from "../types";
import type { Thread, Tx, SellerEscrow } from "../db/types";

// Comptes de démonstration accessibles depuis le sélecteur « Changer de compte ».
// La bascule se fait par authentification (téléphone + mot de passe du compte choisi).
const DEMO_ACCOUNTS = [
  { phone: "+2260701000001", label: "Vendeur", icon: "🌾" },
  { phone: "+2260701000003", label: "Acheteur", icon: "🛒" },
  { phone: "+2260701000005", label: "Livreur", icon: "🛵" },
  { phone: "+2260701000006", label: "Admin", icon: "🛡️" },
];

function formatF(n: number): string {
  return (Number(n) || 0).toLocaleString("fr-FR");
}

const transportEmoji = (t?: string | null) =>
  (t && TRANSPORTS.find((x) => x.label === t)?.emoji) || "🛵";

const DELIVERY_MOVE_LABEL: Record<string, string> = {
  open: "🟡 course ouverte — livreur à trouver",
  accepted: "🔵 course acceptée — récupération",
  picked_up: "🟣 colis récupéré — en livraison",
  done: "✅ livrée",
  cancelled: "✖️ annulée",
};

/** Panneau « Confier au livreur » : le vendeur choisit un livreur proche,
 *  fixe le prix de la course et confie la commande (position + client inclus). */
function AssignPanel({ order, onDone, onClose }: { order: SellerOrder; onDone: () => void; onClose: () => void }) {
  const geo = useApp((s) => s.geo);
  const showToast = useToast((s) => s.show);
  const [couriers, setCouriers] = useState<NearbyCourier[] | null>(null);
  const [sel, setSel] = useState("");
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let g = geo;
        if (!g?.lat) g = await requestLocation();
        if (!alive) return;
        const list = await data.listNearbyCouriers(g?.lat ?? null, g?.lng ?? null);
        if (alive) setCouriers(list);
      } catch {
        if (alive) {
          setCouriers([]);
          showToast("Impossible de lister les livreurs");
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dest = order.delivery?.label || (order.delivery?.lat != null ? `${order.delivery.lat}, ${order.delivery.lng}` : "remis à l'acheteur");
  const feeNum = Number(fee);
  const can = !!sel && feeNum >= 100 && feeNum <= 100000;

  async function confirm() {
    if (!can) return;
    setBusy(true);
    try {
      let g = geo;
      if (!g?.lat) g = await requestLocation();
      await data.assignOrderToCourier({
        txId: order.txId,
        courierId: sel,
        priceFee: feeNum,
        sellerLat: g?.lat ?? null,
        sellerLng: g?.lng ?? null,
        sellerLabel: g?.label && g.label !== "…" ? g.label : undefined,
      });
      showToast("Commande confiée au livreur 🛵");
      onDone();
      onClose();
    } catch (err: any) {
      showToast(err.message || "Confiage impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <b style={{ fontSize: 13 }}>Confier à un livreur</b>
        <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>✕</button>
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 10px" }}>
        Le livreur récupère chez toi et livre <b style={{ color: "var(--ink)" }}>{order.buyerName}</b>.
      </p>
      <p style={{ fontSize: 12, margin: "0 0 8px" }}>
        📍 <b>{dest}</b>
        {order.delivery?.note && <span style={{ color: "var(--muted)" }}> — {order.delivery.note}</span>}
      </p>

      {couriers === null ? (
        <div className="skeleton" style={{ height: 80 }} />
      ) : couriers.length === 0 ? (
        <p className="empty">Aucun livreur disponible pour le moment.</p>
      ) : (
        <div className="list" style={{ maxHeight: 260, overflowY: "auto" }}>
          {couriers.map((c) => (
            <button
              key={c.id}
              className="card hover press"
              style={{ width: "100%", textAlign: "left", display: "flex", gap: 10, alignItems: "center", padding: 10 }}
              onClick={() => setSel(c.id)}
            >
              <div className="avatar">
                {c.selfie ? <img src={c.selfie} alt={c.name} /> : <span>{transportEmoji(c.transport)}</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13 }}>
                  {c.name}
                  {c.proche && <span className="pill open" style={{ fontSize: 9, marginLeft: 6 }}>proche de toi</span>}
                </b>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>
                  {transportEmoji(c.transport)} {c.transport || "livreur"} · {c.locality || c.phone}
                </p>
              </div>
              <input type="radio" checked={sel === c.id} readOnly style={{ accentColor: "var(--orange)" }} />
            </button>
          ))}
        </div>
      )}

      <div className="field" style={{ marginTop: 8 }}>
        <label>Prix de la course (F) — versé au livreur à la livraison</label>
        <input
          type="number"
          min="100"
          max="100000"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          placeholder="ex : 1500"
          inputMode="numeric"
        />
      </div>
      <button
        className="btn btn-primary"
        style={{ marginTop: 8, opacity: can && !busy ? 1 : .6 }}
        disabled={!can || busy}
        onClick={confirm}
      >
        {busy ? "Confiage…" : "Confier la commande au livreur 🛵"}
      </button>
      <p style={{ fontSize: 10, color: "var(--muted2)", margin: "8px 0 0", textAlign: "center" }}>
        Koodo prélève 10 % de commission sur le prix de la course (ajoutée au dû du livreur).
      </p>
    </div>
  );
}

export default function AccountScreen() {
  const user = useApp((s) => s.user);
  const crops = useApp((s) => s.crops);
  const geo = useApp((s) => s.geo);
  const setUser = useApp((s) => s.setUser);
  const setOffers = useApp((s) => s.setOffers);
  const setMyOffers = useApp((s) => s.setMyOffers);
  const setNotifications = useApp((s) => s.setNotifications);
  const setUnseen = useApp((s) => s.setUnseen);
  const lang = useApp((s) => s.lang);
  const setLang = useApp((s) => s.setLang);
  const showToast = useToast((s) => s.show);
  const navigate = useNavigate();
  const clearCart = useCart((s) => s.clear);

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [sales, setSales] = useState<Tx[]>([]);
  const [escrow, setEscrow] = useState<SellerEscrow | null>(null);
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [orderTab, setOrderTab] = useState<"pending" | "done">("pending");
  const [assignFor, setAssignFor] = useState<SellerOrder | null>(null);
  const [courierDues, setCourierDues] = useState<CourierDues | null>(null);
  const [alertCrop, setAlertCrop] = useState("mais");
  const [alertPrice, setAlertPrice] = useState("");
  const [busyAlert, setBusyAlert] = useState(false);
  const [busySettle, setBusySettle] = useState(false);
  const [busySwitch, setBusySwitch] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<{ phone: string; label: string } | null>(null);
  const [switchPassword, setSwitchPassword] = useState("");
  const [settleReceipt, setSettleReceipt] = useState("");
  const receiptRef = useRef<HTMLInputElement>(null);

  const isSeller = user?.role === "producer";
  const isCourier = user?.role === "courier";

  useEffect(() => {
    if (!user) return;
    if (user.role !== "courier") void refreshAlerts();
    void refreshThreads();
    void refreshSales();
    const poll = setInterval(() => void refreshThreads(), 5000);

    // Temps réel : un nouveau message met la liste à jour et ravive la cloche.
    const off = onLive((ev) => {
      if (ev.type === "message") {
        void refreshThreads();
        void refreshNotifications();
      }
      if (ev.type === "order" || ev.type === "delivery") {
        void refreshSales();
        void refreshNotifications();
      }
    });

    return () => {
      clearInterval(poll);
      off();
    };
  }, [user]);

  async function refreshSales() {
    try { setSales(await data.listTransactions()); } catch {}
    if (user?.role === "producer") {
      try { setEscrow(await data.listSellerEscrow()); } catch { setEscrow(null); }
      try { setOrders(await data.listSellerOrders()); } catch { setOrders([]); }
    }
    if (user?.role === "courier") {
      try { setCourierDues(await data.courierDues()); } catch { setCourierDues(null); }
    }
  }

  async function refreshAlerts() {
    try { setAlerts(await data.listAlerts()); } catch {}
  }
  async function refreshThreads() {
    try { setThreads(await data.listThreads()); } catch {}
  }

  async function addAlert(e: React.FormEvent) {
    e.preventDefault();
    const targetPrice = Number(alertPrice);
    if (!targetPrice) return showToast("Indique un prix cible");
    setBusyAlert(true);
    try {
      await data.createAlert(alertCrop, targetPrice);
      showToast("Alerte créée — tu seras prévenu ✓");
      setAlertPrice("");
      await refreshAlerts();
    } catch (err: any) {
      showToast(err.message || "Erreur");
    } finally {
      setBusyAlert(false);
    }
  }

  async function removeAlert(id: string) {
    await data.deleteAlert(id);
    await refreshAlerts();
  }

  async function logout() {
    await data.logout();
    setUser(null);
    setOffers([]);
    setMyOffers([]);
  }

  // Changer de compte PAR AUTHENTIFICATION : on déconnecte le compte courant
  // puis on se connecte au compte choisi avec son mot de passe (jamais auto).
  async function doSwitch() {
    if (!switchTarget) return;
    setBusySwitch(true);
    try {
      await data.logout();
      const u = await data.login(switchTarget.phone, switchPassword);
      setUser(u);
      setOffers([]);
      setMyOffers([]);
      setNotifications([]);
      setUnseen(0);
      clearCart();
      setSwitchTarget(null);
      setSwitchPassword("");
      showToast(`Connecté : ${switchTarget.label} (${switchTarget.phone}) ✓`);
      navigate("/");
    } catch (err: any) {
      showToast(err.message || "Téléphone ou mot de passe incorrect");
    } finally {
      setBusySwitch(false);
    }
  }

  if (!user) return null;
  const initials = user.full_name.split(" ").map((w: string) => w[0]).slice(0, 2).join("");

  // Localisation réelle de la personne (quand la géolocalisation est active),
  // sinon repli sur le profil (région · village).
  const geoLabel =
    geo && geo.lat
      ? geo.label && geo.label !== "…"
        ? geo.label
        : `${geo.lat}, ${geo.lng}`
      : null;
  const placeLabel = geoLabel
    ? `📍 ${geoLabel}`
    : `${user.region || "région d'Ouagadougou"}${user.village ? ` · ${user.village}` : ""}`;

  return (
    <>
      <div className="profile-card">
        <div className="avatar">{initials}</div>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{user.full_name}</p>
          <span className={`role-pill ${isSeller ? "seller" : isCourier ? "buyer" : "buyer"}`}>
            {isSeller ? "🌾 Vendeur" : isCourier ? "🛵 Livreur" : "🛒 Acheteur"}
          </span>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--muted)" }}>
            {placeLabel}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted2)" }} className="font-mono">{user.phone}</p>
        </div>
      </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <span className={`pill ${dbMode === "firebase" ? "open" : "pending"}`}>
          {dbMode === "firebase" ? "Firebase" : "Démo locale"}
        </span>
      </div>

      <div className="card" style={{ marginTop: 10, padding: 12 }}>
        <p className="section-label" style={{ marginTop: 0 }}>{t("account.langue", lang)}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {LANGS.map((l) => (
            <button
              key={l.id}
              className={`btn ${lang === l.id ? "btn-primary btn-sm" : "btn-ghost btn-sm"}`}
              style={{ minWidth: 0 }}
              onClick={() => setLang(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {isCourier && courierDues && (
        <>
          <p className="section-label">Livraisons</p>
          <div className={courierDues.blocked ? "info-card blocked-banner" : "info-card due-banner"}>
            {courierDues.blocked ? (
              <>
                <b>🔴 Compte bloqué</b>
                <p style={{ margin: "4px 0 8px", fontSize: 12 }}>{courierDues.blockedReason}</p>
                {courierDues.pendingPayment ? (
                  <div style={{ fontSize: 12 }}>
                    <p style={{ margin: "0 0 4px" }}>
                      ⏳ Paiement de <b>{courierDues.pendingPayment.amount.toLocaleString("fr-FR")} F</b> envoyé
                      {courierDues.pendingPayment.hasReceipt ? " avec ta capture d'écran" : ""} — en attente de vérification par l'admin.
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>Ton compte sera débloqué dès la confirmation.</p>
                  </div>
                ) : (
                  <>
                    <label style={{ display: "block", fontSize: 12, margin: "0 0 8px", cursor: "pointer" }}>
                      <span style={{ textDecoration: "underline", color: "var(--ink)" }}>
                        {settleReceipt ? "Changer la capture" : "Joindre la capture du paiement (optionnel)"}
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
                            const { pickPhoto } = await import("../components/CourierDossierFields");
                            setSettleReceipt(await pickPhoto(f, 900));
                          } catch {
                            showToast("Capture impossible");
                          }
                        }}
                      />
                    </label>
                    {settleReceipt && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
                        <img src={settleReceipt} alt="capture du paiement" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8 }} />
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>Capture jointe — envoyée à Koodo pour validation.</span>
                      </div>
                    )}
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ width: "100%", opacity: busySettle ? .7 : 1 }}
                      disabled={busySettle}
                      onClick={async () => {
                        setBusySettle(true);
                        try {
                          const d = await data.settleDues(settleReceipt || undefined);
                          setCourierDues(d);
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
                      }}
                    >
                      {busySettle ? "Envoi…" : `Régler mon dû (${courierDues.totalUnpaid.toLocaleString("fr-FR")} F)`}
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <b>💰 Dû du jour : {courierDues.dueToday.toLocaleString("fr-FR")} F</b>
                  <Link to="/livraisons" style={{ textDecoration: "none" }}>
                    <button className="btn btn-ghost btn-sm">Voir mes courses</button>
                  </Link>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted)" }}>
                  Règle tes commissions chaque soir avant 00H pour garder ton compte actif.
                </p>
              </>
            )}
          </div>
        </>
      )}

      {!isCourier && (
        <Link to="/livraisons" style={{ textDecoration: "none" }}>
          <div className="card hover press" style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <b style={{ fontSize: 14 }}>🛵 Trouver un livreur</b>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                Une commande prête ? Confie le colis à un livreur proche.
              </p>
            </div>
            <span style={{ color: "var(--orange)", fontSize: 18 }}>→</span>
          </div>
        </Link>
      )}

      {isSeller && sales.length > 0 && (
        <>
          <p className="section-label">Revenus estimés</p>
          <div className="total-box">
            <div>
              <p style={{ margin: 0, fontSize: 11, color: "#B7E4C7" }}>Total encaissé (sandbox)</p>
              <p className="amount font-display">{sales.reduce((s, t) => s + t.total, 0).toLocaleString("fr-FR")} F CFA</p>
            </div>
          </div>
        </>
      )}

      {isSeller && escrow && (escrow.escrow.count > 0 || escrow.disputed.count > 0) && (
        <>
          <p className="section-label">Fonds sécurisés (escrow)</p>
          <div className="escrow-card">
            <div className="escrow-row">
              <span>🔒 En attente de livraison</span>
              <b className="font-mono">{escrow.escrow.amount.toLocaleString("fr-FR")} F</b>
              <small>{escrow.escrow.count} commande{escrow.escrow.count > 1 ? "s" : ""}</small>
            </div>
            {escrow.delivered.count > 0 && (
              <div className="escrow-row">
                <span>✅ Libérés (confirmé)</span>
                <b className="font-mono">{escrow.delivered.amount.toLocaleString("fr-FR")} F</b>
                <small>{escrow.delivered.count}</small>
              </div>
            )}
            {escrow.disputed.count > 0 && (
              <div className="escrow-row escrow-row-danger">
                <span>⚠️ Litige{escrow.disputed.count > 1 ? "s" : ""} en cours</span>
                <b className="font-mono">{escrow.disputed.amount.toLocaleString("fr-FR")} F</b>
                <small>{escrow.disputed.count}</small>
              </div>
            )}
            <p style={{ fontSize: 11, color: "var(--muted2)", margin: "8px 0 0" }}>
              L'acheteur bloque le paiement tant qu'il n'a pas confirmé la livraison. C'est ta garantie d'un client sérieux.
            </p>
          </div>
        </>
      )}

      {isSeller && (
        <>
          <p className="section-label">📦 Mes commandes</p>
          {orders.length === 0 ? (
            <div className="empty">
              <p>Aucune commande pour le moment.</p>
              <p>Quand un acheteur valide son paiement, retrouve sa commande et sa position ici, et confie-la au livreur proche de chez toi.</p>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, margin: "0 0 8px" }}>
                <button
                  className={`btn btn-sm ${orderTab === "pending" ? "btn-primary" : "btn-ghost"}`}
                  style={{ minWidth: 0, flex: 1 }}
                  onClick={() => setOrderTab("pending")}
                >
                  ⏳ En attente ({orders.filter((o) => o.status === "escrow").length})
                </button>
                <button
                  className={`btn btn-sm ${orderTab === "done" ? "btn-primary" : "btn-ghost"}`}
                  style={{ minWidth: 0, flex: 1 }}
                  onClick={() => setOrderTab("done")}
                >
                  ✅ Validées ({orders.filter((o) => o.status === "delivered").length})
                </button>
              </div>

              <div className="list">
                {(orderTab === "pending"
                  ? orders.filter((o) => o.status === "escrow")
                  : orders.filter((o) => o.status === "delivered")
                ).map((o) => (
                  <div className="card order-card" key={o.txId}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <b style={{ fontSize: 13 }}>
                        {o.items[0]?.cropName || "Commande"}
                        {o.items.length > 1 && <span className="pill pending" style={{ fontSize: 9, marginLeft: 6 }}>+{o.items.length - 1} article(s)</span>}
                      </b>
                      <div style={{ textAlign: "right" }}>
                        <b className="font-mono" style={{ fontSize: 13 }}>{formatF(o.amount)} F</b>
                        <p style={{ margin: 0, fontSize: 10, color: "var(--muted2)" }}>
                          {new Date(o.createdAt).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                    </div>

                    <p style={{ margin: "6px 0 0", fontSize: 12 }}>
                      👤 <b>{o.buyerName}</b> <span className="font-mono" style={{ color: "var(--muted2)", fontSize: 11 }}>{o.buyerPhone}</span>
                    </p>
                    {o.delivery && (o.delivery.label || o.delivery.lat != null) && (
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>
                        📍 {o.delivery.label || `${o.delivery.lat}, ${o.delivery.lng}`}
                        {o.delivery.note && <span> — {o.delivery.note}</span>}
                      </p>
                    )}
                    {o.disputed && (
                      <p className="error-box" style={{ margin: "6px 0 0" }}>⚠️ Litige ouvert — fonds bloqués</p>
                    )}

                    {o.deliveryMove ? (
                      <div style={{ marginTop: 8 }}>
                        <div className="courier-id">
                          <div className="avatar"><span>🛵</span></div>
                          <div>
                            <b style={{ fontSize: 12 }}>{o.deliveryMove.courierName || "Livreur confié"}</b>
                            <small style={{ color: "var(--muted2)" }}>
                              {DELIVERY_MOVE_LABEL[o.deliveryMove.status] || o.deliveryMove.status}
                            </small>
                          </div>
                        </div>
                        {o.deliveryMove.status !== "done" && o.deliveryMove.status !== "cancelled" && (
                          <Link to="/livraisons" style={{ textDecoration: "none" }}>
                            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, width: "100%" }}>
                              Voir la course (codes) →
                            </button>
                          </Link>
                        )}
                      </div>
                    ) : orderTab === "pending" && !o.disputed ? (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ marginTop: 8, width: "100%" }}
                          onClick={() => setAssignFor(assignFor?.txId === o.txId ? null : o)}
                        >
                          🛵 {assignFor?.txId === o.txId ? "Fermer" : "Confier au livreur"}
                        </button>
                        {assignFor?.txId === o.txId && (
                          <AssignPanel order={o} onDone={() => void refreshSales()} onClose={() => setAssignFor(null)} />
                        )}
                      </>
                    ) : null}
                  </div>
                ))}
              </div>

              {orderTab === "pending" && orders.filter((o) => o.status === "escrow").length === 0 && (
                <div className="empty">
                  <p>Aucune commande en attente.</p>
                  <p>Quand un acheteur paie, sa commande apparaît ici pour être confiée à un livreur.</p>
                </div>
              )}
              {orderTab === "done" && orders.filter((o) => o.status === "delivered").length === 0 && (
                <div className="empty">
                  <p>Aucune commande validée pour l'instant.</p>
                  <p>Une commande passe ici quand l'acheteur confirme la réception et libère les fonds.</p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {!isCourier && (
        <>
          <p className="section-label">Alerte prix</p>
          <form className="form-card" onSubmit={addAlert}>
            <div className="field-row">
              <div className="field">
                <label>Culture</label>
                <select value={alertCrop} onChange={(e) => setAlertCrop(e.target.value)}>
                  {crops.map((c: Crop) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Prix cible (F/kg)</label>
                <input type="number" min="1" value={alertPrice} onChange={(e) => setAlertPrice(e.target.value)} placeholder="ex : 400" />
              </div>
            </div>
            <button type="submit" className="btn btn-green" disabled={busyAlert} style={{ opacity: busyAlert ? .7 : 1 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>
              M'avertir quand le prix atteint ma cible
            </button>
            {alerts.length > 0 && (
              <div className="list" style={{ marginTop: 12 }}>
                {alerts.map((a) => (
                  <div className="card alert-item" key={a.id}>
                    <span style={{ fontSize: 13 }}>{a.emoji} {a.crop_name}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="value font-mono">{a.target_price.toLocaleString("fr-FR")} F</span>
                      <button className="btn btn-danger-ghost btn-sm" onClick={() => removeAlert(a.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </form>
        </>
      )}

      <p className="section-label">{t("account.conversations", lang)}</p>
      {threads.length === 0 ? (
        <div className="empty">
          <p>Aucune conversation pour l'instant.</p>
          <p>{isSeller ? "Quand un acheteur t'écrit, retrouve la discussion ici." : "Ouvre une annonce dans Marché pour écrire au producteur."}</p>
        </div>
      ) : (
        <div className="list">
          {threads.map((t) => (
            <Link key={t.offer_id} to={`/message/${t.offer_id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="card hover press">
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {t.emoji} {t.crop_name} · {t.quantity} kg
                    {t.unread != null && t.unread > 0 && <span className="thread-unread">{t.unread}</span>}
                  </span>
                  <span className="pill open">{t.other_role === "producer" ? "producteur" : "acheteur"}</span>
                </div>
                <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  <b style={{ color: "var(--ink)" }}>{t.other_name}</b> — {t.body}
                  {t.unread != null && t.unread > 0 && <span className="thread-dot" />}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="section-label">{t("account.aide", lang)}</p>
      <Link to="/aide" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="card hover press" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <b style={{ fontSize: 14 }}>💬 Demander de l'aide</b>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
              Un problème, une question ? Le service technique Koodo te répond ici.
            </p>
          </div>
          <span style={{ color: "var(--orange)", fontSize: 18 }}>→</span>
        </div>
      </Link>

      <p className="section-label">Sans smartphone ?</p>
      <div className="info-card">
        <span className="title">USSD</span><br />
        Compose <b className="font-mono">#144#</b> depuis n'importe quel téléphone pour consulter les prix du jour, publier une annonce, payer par Mobile Money ou recevoir tes alertes — sans Internet.
      </div>
      {user.ussd_code && (
        <div className="info-card">
          <span className="title">Ton code personnel</span><br />
          <b className="font-mono">{user.ussd_code}</b> — à utiliser pour retrouver tes annonces et paiements.
        </div>
      )}

      {dbMode === "demo" && (
        <>
          <p className="section-label">Changer de compte</p>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "-6px 2px 8px" }}>
            La bascule exige l'authentification du compte de destination.
          </p>
          <div className="list">
            {DEMO_ACCOUNTS.filter((a) => a.phone !== user.phone).map((a) => (
              <button
                key={a.phone}
                className="card hover press switch-account"
                style={{ width: "100%", textAlign: "left" }}
                disabled={busySwitch}
                onClick={() => {
                  setSwitchTarget({ phone: a.phone, label: a.label });
                  setSwitchPassword("");
                }}
              >
                <span style={{ fontSize: 16 }}>{a.icon}</span>
                <span style={{ flex: 1 }}>
                  <b style={{ fontSize: 13 }}>{a.label}</b>
                  <p style={{ margin: "1px 0 0", fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{a.phone}</p>
                </span>
                <span style={{ color: "var(--orange)", fontSize: 16 }}>{switchTarget?.phone === a.phone ? "▼" : "→"}</span>
              </button>
            ))}
          </div>

          {switchTarget && (
            <form
              className="card"
              style={{ marginTop: 8, padding: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                void doSwitch();
              }}
            >
              <p style={{ margin: "0 0 8px", fontSize: 12 }}>
                S'authentifier comme <b>{switchTarget.label}</b>
              </p>
              <div className="field">
                <label>Téléphone</label>
                <input
                  value={switchTarget.phone}
                  readOnly
                  style={{ background: "#f5f1e8" }}
                />
              </div>
              <div className="field">
                <label>Mot de passe</label>
                <input
                  type="password"
                  value={switchPassword}
                  autoFocus
                  placeholder="Mot de passe du compte"
                  onChange={(e) => setSwitchPassword(e.target.value)}
                />
              </div>
              <button className="btn btn-primary" style={{ width: "100%", opacity: busySwitch ? .7 : 1 }} disabled={busySwitch}>
                {busySwitch ? "Connexion…" : "Changer de compte"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ width: "100%", marginTop: 6 }} onClick={() => setSwitchTarget(null)} disabled={busySwitch}>
                Annuler
              </button>
            </form>
          )}

          <p style={{ fontSize: 10, color: "var(--muted)", margin: "8px 2px 0" }}>
            Démo — mot de passe des comptes de démonstration : <b className="font-mono">password123</b>
          </p>
        </>
      )}

      <button className="btn btn-ghost" style={{ marginTop: 12, width: "100%" }} onClick={logout} disabled={busySwitch}>
        {t("account.logout", lang)}
      </button>
    </>
  );
}