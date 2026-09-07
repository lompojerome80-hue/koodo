import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../store";
import { data } from "../data";
import { getProvider } from "../payments/providers";
import { useToast } from "../hooks/useToast";
import type { Tx } from "../db/types";
import type { CourseDelivery } from "../types";

export default function ReceiptScreen() {
  const { txId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useApp((s) => s.user);
  const showToast = useToast((s) => s.show);
  const [tx, setTx] = useState<Tx | null>(null);
  const [myCourse, setMyCourse] = useState<CourseDelivery | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    (async () => {
      const list = await data.listTransactions().catch(() => []);
      const found = list.find((t) => t.id === txId);
      if (found) setTx(found);
      if (found?.delivery) {
        try { setMyCourse(await data.deliveryForMe()); } catch {}
      }
    })();
  }, [txId]);

  const refFromNav = (location.state as any)?.ref as string | undefined;
  const provider = tx ? getProvider(tx.provider) : null;
  const multi = !!tx?.items?.length;

  async function confirmDelivery() {
    if (!tx) return;
    setConfirming(true);
    try {
      await data.confirmDelivery(tx.id);
      setTx({ ...tx, order_status: "delivered" });
      showToast("Fonds libérés au vendeur ✓");
    } catch {
      showToast("Impossible de confirmer pour le moment");
    } finally {
      setConfirming(false);
    }
  }

  async function submitDispute() {
    if (!tx) return;
    try {
      await data.openDispute(tx.id, reason);
      setTx({ ...tx, order_status: "disputed" });
      setDisputeOpen(false);
      showToast("Litige enregistré — fonds bloqués");
    } catch {
      showToast("Impossible d'ouvrir le litige");
    }
  }

  function shareOnWhatsApp() {
    if (!tx) return;
    const ref = refFromNav || tx.ref || tx.id;
    const lines = [
      "Koodo — Reçu de paiement",
      `Réf : ${ref}`,
      ...(tx.items?.map((it) => `${it.emoji || ""} ${it.cropName} · ${it.qtyKg} kg : ${it.amount.toLocaleString("fr-FR")} F`) || []),
      `Montant : ${tx.amount.toLocaleString("fr-FR")} F`,
      tx.fee > 0 ? `Frais : ${tx.fee.toLocaleString("fr-FR")} F` : null,
      `Total : ${tx.total.toLocaleString("fr-FR")} F`,
      `Date : ${new Date(tx.created_at).toLocaleString("fr-FR")}`,
      `Via : ${tx.provider_name || ""}`,
    ]
      .filter((l): l is string => Boolean(l))
      .join("\n");
    const a = document.createElement("a");
    a.href = `https://wa.me/?text=${encodeURIComponent(lines)}`;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.click();
  }

  return (
    <div style={{ paddingTop: 12 }}>
      <div className="receipt">
        <div className="ok-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <h2 className="font-display" style={{ margin: 0, fontSize: 20 }}>Paiement confirmé</h2>
        <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 6px" }}>
          {tx ? `via ${tx.provider_name}` : provider?.name || "Mobile Money"} · {user?.full_name}
        </p>

        {tx ? (
          <>
            <span className="ref">{refFromNav || tx.ref}</span>

            {/* Articles du panier */}
            {multi && (
              <div style={{ margin: "10px 0 4px" }}>
                {(tx.items || []).map((it) => (
                  <div className="row" key={it.offerId}>
                    <span className="k">{it.emoji} {it.cropName} · {it.qtyKg} kg</span>
                    <span className="font-mono">{it.amount.toLocaleString("fr-FR")} F</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ margin: "6px 0" }}>
              <div className="row"><span className="k">Montant</span><span className="font-mono">{tx.amount.toLocaleString("fr-FR")} F</span></div>
              {tx.fee > 0 && <div className="row"><span className="k">Frais</span><span className="font-mono">{tx.fee.toLocaleString("fr-FR")} F</span></div>}
              <div className="row"><span className="k">Total</span><b className="font-mono">{tx.total.toLocaleString("fr-FR")} F</b></div>
              {tx.qtyKg != null && <div className="row"><span className="k">Masse</span><span>{tx.qtyKg} kg</span></div>}
              <div className="row"><span className="k">Date</span><span>{new Date(tx.created_at).toLocaleDateString("fr-FR")} {new Date(tx.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span></div>
            </div>

            {tx.delivery && (
              <div className="receipt-delivery">
                <b style={{ fontSize: 11 }}>📍 Livraison — {tx.delivery.label}</b>
                {tx.delivery.note && <span style={{ fontSize: 11, opacity: .8, display: "block", marginTop: 2 }}>{tx.delivery.note}</span>}
                <span className="font-mono" style={{ fontSize: 10, opacity: .7, display: "block", marginTop: 2 }}>{tx.delivery.lat}, {tx.delivery.lng}</span>
              </div>
            )}

            {myCourse && myCourse.delivery_code && (
              <div className="code-chip" style={{ marginTop: 8, textAlign: "left" }}>
                <div style={{ textAlign: "left" }}>
                  <small>📦 Un livreur achemine ta commande</small>
                  <b style={{ display: "block", color: "var(--ink)", fontSize: 11, marginTop: 2 }}>À la remise, donne-lui ton code :</b>
                </div>
                <b className="font-mono" style={{ fontSize: 16 }}>{myCourse.delivery_code}</b>
              </div>
            )}

            {(myCourse?.courier_name || myCourse?.courier_photo) && (
              <div className="courier-id" style={{ marginTop: 8, justifyContent: "flex-start", textAlign: "left" }}>
                <div className="avatar">
                  {myCourse.courier_photo ? <img src={myCourse.courier_photo} alt="Livreur" /> : <span>🛵</span>}
                </div>
                <div>
                  <b style={{ fontSize: 12 }}>{myCourse.courier_name}</b>
                  <small style={{ color: "var(--muted2)" }}>
                    {myCourse.courier_transport ? `${myCourse.courier_transport} · ` : ""}{myCourse.courier_locality || ""}
                    {myCourse.courier_verified ? " · identité vérifiée ✓" : ""}
                  </small>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="skeleton" style={{ height: 90, margin: "12px 0" }} />
        )}

        <p style={{ fontSize: 11, color: "var(--muted2)" }}>
          Un reçu est disponible hors ligne. Le vendeur peut être contacté depuis l'onglet Marché pour convenir de la livraison.
        </p>

        <div className="no-print receipt-actions" style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn btn-wa" style={{ flex: 1, minWidth: 140 }} disabled={!tx} onClick={shareOnWhatsApp}>
            Partager par WhatsApp
          </button>
          <button className="btn btn-ghost" style={{ flex: 1, minWidth: 100 }} disabled={!tx} onClick={() => window.print()}>
            Imprimer
          </button>
        </div>

        {tx && tx.order_status && tx.order_status !== "delivered" && (
          <div className="escrow-box no-print" style={{ marginTop: 10 }}>
            {tx.order_status === "escrow" ? (
              <>
                <b style={{ fontSize: 12 }}>🔒 Fonds en attente</b>
                <p style={{ fontSize: 11, margin: "4px 0 8px" }}>
                  Ton paiement est sécurisé. Il sera versé au vendeur dès que tu confirmes la livraison.
                </p>
                <button className="btn btn-primary" style={{ width: "100%" }} disabled={confirming} onClick={confirmDelivery}>
                  {confirming ? "Confirmation…" : "J'ai reçu ma livraison ✓"}
                </button>
                {!disputeOpen ? (
                  <button className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setDisputeOpen(true)}>
                    Signaler un litige
                  </button>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    <textarea
                      style={{ height: 52, width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--paper)", color: "var(--ink)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box" }}
                      placeholder="Décris le problème (masse, qualité, livraison…)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <button className="btn btn-danger" style={{ width: "100%", marginTop: 6 }} onClick={submitDispute}>
                      Envoyer le litige
                    </button>
                  </div>
                )}
              </>
            ) : tx.order_status === "disputed" ? (
              <>
                <b style={{ fontSize: 12 }}>⚠️ Litige en cours</b>
                <p style={{ fontSize: 11, margin: "4px 0 0" }}>
                  Les fonds restent bloqués tant que le litige n'est pas résolu. L'application t'avertira de l'issue.
                </p>
              </>
            ) : null}
          </div>
        )}

        {tx && tx.order_status === "delivered" && (
          <div className="escrow-box escrow-ok no-print" style={{ marginTop: 10 }}>
            <b style={{ fontSize: 12 }}>✅ Fonds libérés</b>
            <p style={{ fontSize: 11, margin: "4px 0 0" }}>Le vendeur a reçu ton paiement. Transaction terminée.</p>
          </div>
        )}
      </div>

      <button className="btn btn-primary no-print" style={{ marginTop: 16 }} onClick={() => navigate("/marche")}>
        Retour au marché
      </button>
      <button className="btn btn-ghost no-print" style={{ marginTop: 8, width: "100%" }} onClick={() => navigate("/compte")}>
        Voir mes achats
      </button>
    </div>
  );
}