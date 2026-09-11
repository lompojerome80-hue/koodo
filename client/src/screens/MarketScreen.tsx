import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { useToast } from "../hooks/useToast";
import { data } from "../data";
import { useCart } from "../cart";
import type { Offer } from "../types";

function OfferCard({ o }: { o: Offer }) {
  const user = useApp((s) => s.user);
  const addToCart = useCart((s) => s.add);
  const showToast = useToast((s) => s.show);
  const navigate = useNavigate();
  const isBuyer = user?.role === "buyer";
  const isOwn = user?.id && o.seller_id === user.id;
  const [qty, setQty] = useState(1);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busyReport, setBusyReport] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const buy = () => navigate(`/payer/${o.id}`, { state: { qtyKg: qty } });

  async function submitReport() {
    if (!reason) return showToast("Choisis une raison du signalement");
    setBusyReport(true);
    try {
      await data.reportOffer(o.id, reason, note);
      showToast("Annonce signalée — l'équipe Koodo va vérifier ✓");
      setReporting(false);
      setReason("");
      setNote("");
    } catch (err: any) {
      showToast(err.message || "Signalement impossible");
    } finally {
      setBusyReport(false);
    }
  }

  async function blockSeller() {
    if (!o.seller_id) return;
    if (!window.confirm(`Bloquer ${o.seller || "ce vendeur"} ?\nSes annonces et messages disparaîtront de ton écran.`)) return;
    setBlocking(true);
    try {
      await data.blockUser(o.seller_id);
      useApp.getState().setOffers(useApp.getState().offers.filter((x) => x.seller_id !== o.seller_id));
      showToast("Vendeur bloqué — annonces masquées");
    } catch (err: any) {
      showToast(err.message || "Blocage impossible");
    } finally {
      setBlocking(false);
    }
  }

  return (
    <div className="card offer-card hover">
      {o.image && <img className="offer-thumb" src={o.image} alt={o.crop_name} />}
      <div className="left">
        <p>{o.emoji} {o.crop_name} · {o.quantity} kg</p>
        <p className="font-mono">{o.unit_price.toLocaleString("fr-FR")} F CFA/kg</p>
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>
          {o.seller}{o.village ? ` · ${o.village}` : ""}{o.region ? ` · ${o.region}` : ""}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {isBuyer && (
          <>
            <div className="mini-qty">
              <input
                className="qty-input"
                value={qty}
                inputMode="decimal"
                onChange={(e) => setQty(Math.min(Math.max(0, Number(e.target.value.replace(",", ".")) || 0), o.quantity))}
                aria-label="quantité en kg"
              />
              <span className="qty-unit">kg</span>
            </div>
            <button
              className="btn btn-green btn-sm"
              onClick={() => {
                addToCart(o, qty);
                showToast(`${Math.min(Math.max(1, qty || 1), o.quantity)} kg de ${o.crop_name} ajoutés ✓`);
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 8v8M8 12h8"/></svg>
              Panier
            </button>
            <button className="btn btn-primary btn-sm" onClick={buy}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>
              Acheter
            </button>
          </>
        )}
        {o.id && (
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/message/${o.id}`)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            Écrire
          </button>
        )}
        {!isOwn && (
          <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
            <button
              className="btn btn-danger-ghost btn-sm"
              style={{ flex: 1, minWidth: 0 }}
              onClick={() => setReporting((v) => !v)}
            >
              🚩 {reporting ? "Fermer" : "Signaler"}
            </button>
            <button
              className="btn btn-danger-ghost btn-sm"
              style={{ flex: 1, minWidth: 0 }}
              disabled={blocking || !o.seller_id}
              onClick={blockSeller}
            >
              {blocking ? "…" : "🔕 Bloquer"}
            </button>
          </div>
        )}
        {reporting && (
          <div style={{ marginTop: 6 }}>
            <select
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--paper)", color: "var(--ink)", fontFamily: "inherit", fontSize: 13, boxSizing: "border-box" }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">Pourquoi signaler ?</option>
              <option value="Prix abusif">Prix abusif</option>
              <option value="Produit inexistant">Produit inexistant</option>
              <option value="Arnaque / fraude">Arnaque / fraude</option>
              <option value="Contenu inapproprié">Contenu inapproprié</option>
              <option value="Annonce hors-liste">Annonce hors-liste</option>
              <option value="Autre">Autre</option>
            </select>
            <textarea
              style={{ height: 44, width: "100%", marginTop: 6, padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--paper)", color: "var(--ink)", fontFamily: "inherit", fontSize: 12, boxSizing: "border-box", resize: "none" }}
              placeholder="Détails (facultatif)…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="btn btn-danger btn-sm"
              style={{ width: "100%", marginTop: 6, opacity: busyReport || !reason ? .6 : 1 }}
              disabled={busyReport || !reason}
              onClick={submitReport}
            >
              {busyReport ? "Envoi…" : "Envoyer le signalement"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MarketScreen() {
  const user = useApp((s) => s.user);
  const online = useApp((s) => s.online);
  const setOffers = useApp((s) => s.setOffers);
  const showToast = useToast((s) => s.show);
  const navigate = useNavigate();
  const offers = useApp((s) => s.offers);
  const cartCount = useCart((s) => s.items.length);
  const isBuyer = user?.role === "buyer";

  const refresh = async () => {
    try {
      setOffers(await data.listMarketOffers());
      showToast("Marché rafraîchi ✓");
    } catch {
      showToast("Impossible de rafraîchir maintenant");
    }
  };

  return (
    <>
      <p className="section-label">
        Le marché ouvert
        <span className="count">{offers.filter((o) => o.status === "open").length} annonces</span>
      </p>
      <p className="info-card">
        <span className="title">Vente directe, sans intermédiaire</span><br />
        {isBuyer
          ? "Choisis la masse que tu veux, ajoute au panier puis paie par Mobile Money. Envoie ta position pour la livraison."
          : "Voici les offres publiées par les producteurs de ta région — compare et suis le marché."}
      </p>

      {isBuyer && (
        <button className="btn btn-primary" style={{ width: "100%", marginBottom: 12 }} onClick={() => navigate("/panier")}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6h15l-2 9H8L5 3H2"/><circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/></svg>
          Voir mon panier {cartCount > 0 && <span className="pill open">{cartCount}</span>}
        </button>
      )}

      <div className="list">
        {offers.filter((o) => o.status === "open").length === 0 ? (
          <div className="empty">
            <div className="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 10l5-6 5 6M9 9v8m6-8v8"/><path d="M4 16.5V21h16v-4.5"/></svg></div>
            <p>Aucune annonce en ligne pour le moment.</p>
            <p>Reviens bientôt ou appuie ci-dessous pour rafraîchir.</p>
          </div>
        ) : (
          offers.filter((o) => o.status === "open").map((o: Offer) => <OfferCard key={o.id} o={o} />)
        )}
      </div>

      <button className="btn btn-ghost" style={{ marginTop: 14, width: "100%" }} onClick={refresh}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        Rafraîchir le marché
      </button>
      {!online && (
        <p style={{ fontSize: 11, color: "var(--muted2)", marginTop: 8, textAlign: "center" }}>
          Mode économie : les annonces affichées sont celles de ta dernière session.
        </p>
      )}
    </>
  );
}