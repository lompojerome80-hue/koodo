import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { data } from "../data";
import type { Crop } from "../types";

interface Item {
  crop: Crop;
  avgChange: number;
  bestPrice: number;
  markets: { market: string; today: number; changePct: number }[];
}

export default function ConseilScreen() {
  const crops = useApp((s) => s.crops);
  const navigate = useNavigate();
  const [top, setTop] = useState<Item[]>([]);
  const [bottom, setBottom] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const items: Item[] = [];
      for (const crop of crops) {
        const trends = await data.getTrend(crop.id).catch(() => []);
        if (!trends.length) continue;
        const avgChange = trends.reduce((s, t) => s + t.changePct, 0) / trends.length;
        items.push({
          crop,
          avgChange,
          bestPrice: Math.max(...trends.map((t) => t.today)),
          markets: trends.slice(0, 3),
        });
      }
      setTop(items.filter((x) => x.avgChange > 0).sort((a, b) => b.avgChange - a.avgChange).slice(0, 5));
      setBottom(items.filter((x) => x.avgChange < 0).sort((a, b) => a.avgChange - b.avgChange).slice(0, 3));
      setLoading(false);
    })();
  }, [crops.length]);

  if (loading) {
    return <div className="empty">Analyse des tendances du marché…</div>;
  }

  return (
    <>
      <button className="btn btn-ghost" style={{ marginBottom: 14 }} onClick={() => navigate("/")}>
        ← Retour aux prix
      </button>

      <div className="info-card" style={{ marginBottom: 14 }}>
        <b className="title">💡 Conseil de plantation — saison en cours</b>
        <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.45 }}>
          Analyse automatique des 72 dernières heures. Ces tendances t'aident à choisir quoi planter
          et quand vendre. Les cultures en hausse sont les plus rentables à court terme.
        </p>
      </div>

      {top.length > 0 && (
        <>
          <p className="section-label">Augmentation — bonnes opportunités</p>
          <div className="list">
            {top.map((it) => (
              <div className="card" key={it.crop.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div>
                  <b style={{ fontSize: 14 }}>{it.crop.emoji} {it.crop.name}</b>
                  <span className="badge green" style={{ marginLeft: 8 }}>+{Math.round(it.avgChange)}% /72h</span>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>
                    {it.markets.map((m) => `${m.market}: ${m.today} F`).join(" · ")}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p className="font-mono" style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
                    ~{it.bestPrice.toLocaleString("fr-FR")} F/kg
                  </p>
                  <span style={{ fontSize: 10, color: "#B7E4C7" }}>meilleur marché</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {bottom.length > 0 && (
        <>
          <p className="section-label" style={{ marginTop: 18 }}>Baisse — reporte la vente si possible</p>
          <div className="list">
            {bottom.map((it) => (
              <div className="card" key={it.crop.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div>
                  <b style={{ fontSize: 14 }}>{it.crop.emoji} {it.crop.name}</b>
                  <span className="badge" style={{ marginLeft: 8, background: "rgba(184,71,30,.15)", color: "var(--alert)" }}>
                    {Math.round(it.avgChange)}% /72h
                  </span>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>
                    {it.markets.map((m) => `${m.market}: ${m.today} F`).join(" · ")}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p className="font-mono" style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
                    ~{it.bestPrice.toLocaleString("fr-FR")} F/kg
                  </p>
                  <span style={{ fontSize: 10, color: "var(--muted2)" }}>meilleur marché</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {top.length === 0 && bottom.length === 0 && (
        <div className="empty">
          <p>Pas assez de données pour formuler un conseil.</p>
          <p>Signale des prix chaque jour pour enrichir les tendances.</p>
        </div>
      )}

      <p className="info-card" style={{ marginTop: 16 }}>
        <b>Arbitrage culture :</b> plante la culture dont le prix monte le plus
        sur ton marché ; signale le prix régulièrement pour améliorer la précision des tendances.
        En saison sèche, igname et maïs restent les plus stables en prix.
      </p>
    </>
  );
}