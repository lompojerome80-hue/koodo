import { useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { useNavigate } from "react-router-dom";
import { data, dbMode } from "../data";
import { offline } from "../offline";
import { requestLocation } from "../geo";
import { haversineKm } from "../db/seed";
import { useToast } from "../hooks/useToast";
import { t as i18n } from "../i18n";
import type { Crop, PriceRow, TrendRow } from "../types";

const NO_TREND = 0;

export default function PricesScreen() {
  const crops = useApp((s) => s.crops);
  const selectedCrop = useApp((s) => s.selectedCrop);
  const setSelectedCrop = useApp((s) => s.setSelectedCrop);
  const online = useApp((s) => s.online);
  const geo = useApp((s) => s.geo);
  const lang = useApp((s) => s.lang);
  const showToast = useToast((s) => s.show);

  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState("");
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reportValue, setReportValue] = useState("");
  const [reporting, setReporting] = useState(false);
  const chipsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    let unsub: () => void = () => {};
    let cancelled = false;

    const onRows = (rows: PriceRow[]) => {
      if (cancelled) return;
      setPrices(rows);
      setLoading(false);
      setLastUpdate(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
      if (dbMode === "demo") void offline.cachePrices(selectedCrop, rows);
    };

    // Abonnement temps réel : Firestore onSnapshot (Firebase) ou
    // rafraîchissement périodique + micro-variations (mode démo).
    unsub = data.subscribePrices(selectedCrop, onRows);

    void data.getTrend(selectedCrop).then((t) => { if (!cancelled) setTrend(t); }).catch(() => {});

    return () => { cancelled = true; unsub(); };
  }, [selectedCrop, tick]);

  const cropName = crops.find((c) => c.id === selectedCrop)?.name || "la culture";
  const unit = crops.find((c) => c.id === selectedCrop)?.unit || "kg";
  const best = prices[0];
  const live = dbMode === "firebase" ? online : prices.length > 0;
  const hasPos = !!geo?.lat;

  // Distance depuis la position géolocalisée de la personne (si consentie),
  // sinon distance depuis Ouagadougou fournie par le serveur.
  const km = (r: PriceRow) =>
    hasPos && r.lat != null && r.lng != null
      ? haversineKm({ lat: geo.lat, lng: geo.lng }, { lat: r.lat, lng: r.lng })
      : r.distance;

  // Les prix sont proposés en fonction de la localisation : quand la personne
  // a partagé sa position, les villes proches apparaissent en premier.
  const ordered = hasPos ? [...prices].sort((a, b) => km(a) - km(b)) : prices;

  const shown = query.trim()
    ? crops.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : crops;

  // Fait défiler la barre horizontale vers le produit sélectionné (recherche, chip, etc.)
  useEffect(() => {
    chipsRef.current?.querySelector(".chip.active")?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedCrop]);

  async function submitReport(marketId: string, name: string) {
    const v = Number(reportValue);
    if (!v || v <= 0) return showToast("Entre un prix valide en F CFA");
    setReporting(true);
    try {
      const res = await data.reportPrice(selectedCrop, marketId, v);
      if (res.status === "published") {
        showToast(`Prix publié : ${name} à ${(res.price ?? v).toLocaleString("fr-FR")} F ✓`);
      } else {
        const missing = Math.max(0, res.reportsNeeded - res.confirmedBy);
        showToast(`Signalement enregistré — ${missing} signalement(s) concordant(s) encore requis (${res.confirmedBy}/${res.reportsNeeded})`);
      }
      setReportFor(null);
      setReportValue("");
      setTick((t) => t + 1); // rafraîchit immédiatement le prix communautaire
    } catch {
      showToast("Échec de l'envoi — vérifie ta connexion");
    } finally {
      setReporting(false);
    }
  }

  if (crops.length === 0) {
    return <div className="empty">Chargement des cultures…</div>;
  }

  return (
    <>
      <input
        className="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={i18n("prices.search", lang)}
      />
      <div className="chips" ref={chipsRef}>
        {shown.map((c: Crop) => (
          <button key={c.id} className={`chip ${c.id === selectedCrop ? "active" : ""}`} onClick={() => setSelectedCrop(c.id)}>
            {c.emoji} {c.name}
          </button>
        ))}
        {shown.length === 0 && <span className="empty" style={{ padding: "4px 0" }}>Aucun produit trouvé</span>}
      </div>

      {!hasPos && prices.length > 0 && (
        <button className="locate-btn" onClick={() => void requestLocation(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3m10-10h-3m-14 0H2"/></svg>
          Afficher les prix près de chez moi
        </button>
      )}

      {loading && prices.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="skeleton" style={{ height: 92 }} />
          <div className="skeleton" style={{ height: 58 }} />
          <div className="skeleton" style={{ height: 58 }} />
        </div>
      ) : (
        <div className="best-hero">
          <div style={{ position: "relative", zIndex: 1 }}>
            <p className="eyebrow">{i18n("prices.best", lang)}</p>
            <p className="price font-display">{best ? best.price.toLocaleString("fr-FR") : "—"} <small>F CFA/{unit}</small></p>
            <p className="market">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>
              {best ? `${best.market} · à ${km(best)} km${hasPos ? " de toi" : ""}` : "en attente des données"}
            </p>
          </div>
          <div className="hero-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l6-6 4 4 8-8M21 7v6M21 7h-6"/></svg>
          </div>
        </div>
      )}

      <div className="section-label">
        {i18n("prices.table", lang)} — {cropName}
        <span className="count">{prices.length} villes{hasPos ? " · triées par distance" : ""}</span>
        <button
          className="link-btn"
          style={{ marginLeft: 8, fontSize: 12, padding: 0, fontWeight: 500 }}
          onClick={() => navigate("/conseil")}
        >
          💡 Conseil plantation
        </button>
      </div>

      <div className="live-dot" style={{ marginBottom: 8 }}>
        <span className="pulse" />
        {i18n("prices.live", lang)}{live ? "" : " · " + i18n("prices.live.stale", lang)}
      </div>

      <div className="list">
        {ordered.map((r, i) => {
          const isBest = best && r.market_id === best.market_id;
          const diff = best && best.price < r.price ? r.price - best.price : 0;
          const isNearest = i === 0 && ordered.length > 1;
          const t = trend.find((x) => x.market === r.market);
          const pct = t ? t.changePct : NO_TREND;
          const editing = reportFor === r.market_id;
          return (
            <div className="card price-card hover" key={r.market_id}>
              {editing ? (
                <div className="price-report">
                  <p className="price-report-title">Prix du jour vu à <b>{r.market}</b> (F CFA/{unit})</p>
                  <input
                    inputMode="numeric"
                    placeholder="Ex : 1 500"
                    value={reportValue}
                    onChange={(e) => setReportValue(e.target.value.replace(/[^\d]/g, ""))}
                  />
                  <div className="report-actions">
                    <button className="btn btn-primary" disabled={reporting} onClick={() => void submitReport(r.market_id, r.market)}>
                      {reporting ? "Envoi…" : "Envoyer"}
                    </button>
                    <button className="btn ghost" onClick={() => { setReportFor(null); setReportValue(""); }}>
                      Annuler
                    </button>
                  </div>
                  <p className="price-report-note">{i18n("prices.report.note", lang)}</p>
                </div>
              ) : (
                <>
                  <div className="main">
                    <div className="name">
                      <p>{r.market}</p>
                      {isBest && <span className="badge">{i18n("prices.badge.best", lang)}</span>}
                      {!isBest && hasPos && isNearest && <span className="badge">{i18n("prices.badge.near", lang)}</span>}
                      {!isBest && diff > 0 && !(hasPos && isNearest) && <span className="badge green">−{diff.toLocaleString("fr-FR")} F</span>}
                    </div>
                    <div className="meta">
                      <span><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>{km(r)} km</span>
                      <span>màj {lastUpdate}</span>
                      {r.source === "community" && <span className="badge green">{i18n("prices.badge.community", lang)}</span>}
                      {t && (
                        <span className={pct < 0 ? "old" : ""}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {pct >= 0
                              ? <path d="M3 17l6-6 4 4 8-8M21 7v6M21 7h-6" />
                              : <path d="M3 7l6 6 4-4 8 8M21 17v-6M21 17h-6" />}
                          </svg>
                          {pct >= 0 ? "+" : ""}{pct}% /72h
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="price-side">
                    <p className="price-big font-mono">{r.price.toLocaleString("fr-FR")}</p>
                    <button className="report-link" onClick={() => { setReportFor(r.market_id); setReportValue(String(r.price)); }}>
                      + {i18n("prices.report", lang)}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <p className="info-card" style={{ marginTop: 16 }}>
        {dbMode === "firebase"
          ? "Prix synchronisés en direct depuis la base Firestore. Ils restent consultables hors ligne grâce à la persistance locale."
          : "Ces prix se rafraîchissent automatiquement au retour du réseau ; ils restent affichés même sans connexion."}
      </p>
    </>
  );
}