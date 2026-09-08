import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useApp } from "../store";
import { useCart } from "../cart";
import { flushOfflineQueue } from "../sync";
import { offline } from "../offline";
import { useToast } from "../hooks/useToast";
import { requestLocation, restoreLocation } from "../geo";
import { refreshNotifications, markAllNotificationsRead } from "../notif";
import type { AppNotification } from "../types";
import { t, type Lang } from "../i18n";

function timeAgo(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useApp((s) => s.online);
  const lang = useApp((s) => s.lang);
  const pendingSync = useApp((s) => s.pendingSync);
  const setPendingSync = useApp((s) => s.setPendingSync);
  const geo = useApp((s) => s.geo);
  const geoTrying = useApp((s) => s.geoTrying);
  const user = useApp((s) => s.user);
  const notifications = useApp((s) => s.notifications);
  const unseen = useApp((s) => s.unseen);
  const cartCount = useCart((s) => s.items.length);
  const showToast = useToast((s) => s.show);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    restoreLocation();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    refreshNotifications();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refreshNotifications();
    }, 30_000);
    return () => clearInterval(t);
  }, [user?.id]);

  async function askLocation() {
    try {
      const g = await requestLocation(true);
      if (g) showToast(`Localisation : ${g.label}`);
      else showToast("Localisation refusée ou indisponible");
    } catch {
      showToast("Impossible d'obtenir ta localisation");
    }
  }

  function onNotifTap(n: AppNotification) {
    setNotifOpen(false);
    markAllNotificationsRead();
    if (n.kind === "message" && n.offer_id) {
      navigate(`/message/${n.offer_id}`);
      return;
    }
    navigate(user?.role === "courier" ? "/livraisons" : "/compte");
  }

  const isCourier = user?.role === "courier";
  const isAdmin = user?.role === "admin";
  const L: Lang = lang;
  const tabs = isCourier
    ? [
        { tab: "/livraisons", key: "/livraisons", label: t("nav.livraisons", L) },
        { tab: "/compte", label: t("nav.compte", L) },
      ]
    : isAdmin
      ? [
          { tab: "/admin", key: "/admin", label: t("nav.admin", L) },
          { tab: "/compte", label: t("nav.compte", L) },
        ]
      : [
          { tab: "/", label: t("nav.prix", L) },
          { tab: "/vendre", label: t("nav.vendre", L) },
          { tab: "/marche", label: t("nav.marche", L) },
          { tab: "/compte", label: t("nav.compte", L) },
        ];

  async function onSyncTap() {
    if (!online) return;
    const n = await flushOfflineQueue();
    const pending = await offline.listQueue();
    setPendingSync(pending.length);
    if (n > 0) {
      useToast.getState().show(n === 1 ? "Annonce synchronisée ✓" : `${n} annonces synchronisées ✓`);
    }
  }

  const showSync = online && pendingSync > 0;

  return (
    <div className="app-shell">
      <div className={`conn-bar ${online ? "" : "offline"}`}>
        <span className="status">
          <span className="dot" />
          {online ? t("conn.online", L) : t("conn.offline", L)}
        </span>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {showSync && (
            <button className="sync" onClick={onSyncTap}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              {pendingSync} à envoyer
            </button>
          )}
          {geoTrying ? (
            <span className="loc">
              <span className="live-dot"><span className="pulse" /></span> Localisation…
            </span>
          ) : geo ? (
            <button className="loc loc-has" onClick={askLocation} title="Mettre à jour ma position">
              <span className="live-dot"><span className="pulse" /></span> {geo.label}
            </button>
          ) : (
            <button className="loc loc-ask" onClick={askLocation}>
              📍 Me localiser
            </button>
          )}
        </span>
      </div>

      <header className="top-header">
        <div className="brand">
          <div className="logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 22V10M12 10c0-3 2-5 5-5M12 10C12 7 10 5 7 5" stroke="#1B4332" strokeWidth="2.2" strokeLinecap="round"/></svg>
          </div>
          <div>
            <h1>Koodo</h1>
            <p className="tagline">{t("tagline", L)}</p>
          </div>
        </div>
        <div className="header-actions">
          {user?.id && (
            <button
              className={`bell-btn ${notifOpen ? "active" : ""} ${unseen > 0 ? "has-unseen" : ""}`}
              onClick={() => setNotifOpen((v) => !v)}
              aria-label="Notifications"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
              {unseen > 0 && <span className="bell-badge">{unseen > 9 ? "9+" : unseen}</span>}
            </button>
          )}
          {user?.role === "buyer" && (
            <button className={`cart-btn ${location.pathname === "/panier" ? "active" : ""}`} onClick={() => navigate("/panier")} aria-label="Panier">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6h15l-2 9H8L5 3H2"/><circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/></svg>
              {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
            </button>
          )}
        </div>
      </header>

      {notifOpen && (
        <>
          <div className="notif-backdrop" onClick={() => setNotifOpen(false)} />
          <aside className="notif-panel">
            <div className="notif-head">
              <h3>Notifications</h3>
              {unseen > 0 && (
                <button className="notif-read" onClick={markAllNotificationsRead}>
                  Tout marquer lu
                </button>
              )}
            </div>
            <div className="notif-list">
              {notifications.length === 0 ? (
                <p className="notif-empty">Aucune notification pour le moment.</p>
              ) : (
                notifications.map((n) => (
                  <button key={n.id} className={`notif-item ${n.seen ? "" : "unseen"}`} onClick={() => onNotifTap(n)}>
                    <span className="notif-avatar">
                      {n.actor_photo ? (
                        <img src={n.actor_photo} alt={n.actor_name || ""} />
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>
                      )}
                    </span>
                    <span className="notif-body">
                      <span className="notif-title">{n.title}</span>
                      <span className="notif-text">{n.body}</span>
                    </span>
                    <span className="notif-time">{timeAgo(n.created_at)}</span>
                  </button>
                ))
              )}
            </div>
          </aside>
        </>
      )}

      <main className="screen">{children}</main>

      <nav className="bottom-nav">
        {tabs.map((t) => {
          const active = location.pathname === t.tab || (t.tab !== "/" && location.pathname.startsWith(t.tab));
          return (
            <button key={t.tab} className={active ? "active" : ""} onClick={() => navigate(t.tab)}>
              {t.tab === "/" && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l6-6 4 4 8-8M21 7v6M21 7h-6"/></svg>
              )}
              {t.tab === "/vendre" && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
              )}
              {t.key === "/livraisons" && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5h11v11H3zM11 18a2 2 0 104 0 2 2 0 00-4 0zM18 16h1a2 2 0 002-2V9l-4-3-3 1"/><circle cx="17" cy="18" r="2"/></svg>
              )}
              {t.key === "/admin" && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>
              )}
              {t.tab === "/marche" && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 10l5-6 5 6M9 10v7m6-7v7"/><path d="M4 17h16v3H4z"/></svg>
              )}
              {t.tab === "/compte" && (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>
                </>
              )}
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}