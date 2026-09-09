import { useEffect, useState } from "react";
import { useApp } from "../store";
import { useToast } from "../hooks/useToast";
import { data } from "../data";
import { getProvider } from "../payments/providers";
import { onLive } from "../realtime";
import QrCode from "../components/QrCode";
import type { BuyerOrder } from "../types";

const COURSE_LABEL: Record<string, string> = {
  open: "🟡 livreur à trouver",
  accepted: "🔵 récupération du colis",
  picked_up: "🟣 en livraison",
  done: "✅ livrée",
  cancelled: "✖️ annulée",
};

function formatF(n: number): string {
  return (Number(n) || 0).toLocaleString("fr-FR");
}

export default function MyPurchasesScreen() {
  const showToast = useToast((s) => s.show);
  const [purchases, setPurchases] = useState<BuyerOrder[] | null>(null);
  const [tab, setTab] = useState<"ongoing" | "done">("ongoing");
  const [open, setOpen] = useState<string | null>(null);
  const [releaseBusy, setReleaseBusy] = useState("");

  async function load() {
    try {
      setPurchases(await data.listMyPurchases());
    } catch {
      setPurchases([]);
      showToast("Impossible de charger tes achats");
    }
  }

  useEffect(() => {
    void load();
    const off = onLive((ev) => {
      if (ev.type === "delivery" || ev.type === "order") void load();
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function releaseFunds(o: BuyerOrder) {
    setReleaseBusy(o.txId);
    try {
      await data.confirmDelivery(o.txId);
      showToast("Fonds libérés au vendeur ✓");
      await load();
    } catch (err: any) {
      showToast(err.message || "Libération impossible");
    } finally {
      setReleaseBusy("");
    }
  }

  const ongoing = (purchases || []).filter((p) => p.status === "escrow");
  const done = (purchases || []).filter((p) => p.status === "delivered");
  const shown = tab === "ongoing" ? ongoing : done;

  return (
    <>
      <p className="section-label">
        Mes achats <span className="count">{(purchases || []).length}</span>
        <button
          className="btn btn-ghost btn-sm"
          style={{ float: "right", minWidth: 0, padding: "2px 8px" }}
          onClick={() => void load()}
        >
          ↻
        </button>
      </p>
      <p className="info-card">
        Tes commandes payées apparaissent ici. Tant que le colis n'est pas remis, le paiement reste
        <b> bloqué</b> chez Koodo ; dès que le livreur valide la livraison, il est <b>libéré</b> au vendeur.
      </p>

      <div style={{ display: "flex", gap: 8, margin: "0 0 8px" }}>
        <button
          className={`btn btn-sm ${tab === "ongoing" ? "btn-primary" : "btn-ghost"}`}
          style={{ minWidth: 0, flex: 1 }}
          onClick={() => setTab("ongoing")}
        >
          🚚 En cours ({ongoing.length})
        </button>
        <button
          className={`btn btn-sm ${tab === "done" ? "btn-primary" : "btn-ghost"}`}
          style={{ minWidth: 0, flex: 1 }}
          onClick={() => setTab("done")}
        >
          ✅ Libérés ({done.length})
        </button>
      </div>

      {(shown.length === 0 || !purchases) && (
        <div className="empty">
          <div className="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12V8H6a2 2 0 01-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 000 4h4v-4h-4z"/></svg></div>
          <p>{purchases ? "Aucun achat ici." : "Chargement…"}</p>
          <p>
            {tab === "ongoing"
              ? "Quand tu paies une commande dans Marché, elle apparaît ici en attente."
              : "Tes achats libérés apparaîtront ici une fois les colis livrés."}
          </p>
        </div>
      )}

      <div className="list">
        {shown.map((p) => {
          const isOpen = open === p.txId;
          const move = p.deliveryMove;
          const active = move && move.status !== "done" && move.status !== "cancelled";
          const code = move?.deliveryCode;
          return (
            <div className="card order-card" key={p.txId}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b style={{ fontSize: 13 }}>
                  {p.items[0]?.cropName || "Commande"}
                  {p.items.length > 1 && <span className="pill pending" style={{ fontSize: 9, marginLeft: 6 }}>+{p.items.length - 1}</span>}
                </b>
                <div style={{ textAlign: "right" }}>
                  <b className="font-mono" style={{ fontSize: 13 }}>{formatF(p.amount)} F</b>
                  <p style={{ margin: 0, fontSize: 10, color: "var(--muted2)" }}>
                    {new Date(p.createdAt).toLocaleDateString("fr-FR")}
                  </p>
                </div>
              </div>

              <p style={{ margin: "6px 0 0", fontSize: 12 }}>
                🌾 <b>{p.sellerName || "vendeur"}</b>
                {p.reference && <span className="font-mono" style={{ color: "var(--muted2)", fontSize: 10 }}> · Réf {p.reference}</span>}
              </p>
              {p.delivery && (p.delivery.label || p.delivery.lat != null) && (
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>
                  📍 {p.delivery.label || `${p.delivery.lat}, ${p.delivery.lng}`}
                  {p.delivery.note && <span> — {p.delivery.note}</span>}
                </p>
              )}
              {move && (
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted2)" }}>
                  📦 {COURSE_LABEL[move.status] || move.status}
                  {move.courierName ? ` · 🛵 ${move.courierName}` : ""}
                </p>
              )}

              {tab === "ongoing" && p.disputed && (
                <p className="error-box" style={{ margin: "6px 0 0" }}>⚠️ Litige ouvert — fonds bloqués</p>
              )}

              {tab === "ongoing" && !p.disputed && (
                <>
                  {p.releaseable ? (
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: 8, width: "100%", opacity: releaseBusy === p.txId ? .7 : 1 }}
                      disabled={releaseBusy === p.txId}
                      onClick={() => void releaseFunds(p)}
                    >
                      {releaseBusy === p.txId ? "Libération…" : "🔓 Libérer les fonds au vendeur"}
                    </button>
                  ) : active && code ? (
                    <>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ marginTop: 8, width: "100%" }}
                        onClick={() => setOpen(isOpen ? null : p.txId)}
                      >
                        {isOpen ? "Masquer le code" : "🗝️ Voir mon code de livraison"}
                      </button>
                      {isOpen && (
                        <div className="code-chip" style={{ marginTop: 8 }}>
                          <div>
                            <small>Donne ce code au livreur à la remise (ou montre le QR) :</small>
                            <b className="font-mono" style={{ display: "block", fontSize: 18 }}>{code}</b>
                          </div>
                          <QrCode value={code} size={96} />
                        </div>
                      )}
                    </>
                  ) : (
                    <p style={{ fontSize: 11, color: "var(--muted2)", margin: "8px 0 0" }}>
                      🚚 Ton colis est en route — le livreur validera la livraison à la remise.
                    </p>
                  )}
                </>
              )}

              {tab === "done" && (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--green-2)" }}>
                  ✅ Paiement libéré au vendeur · {getProvider(p.provider).name}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}