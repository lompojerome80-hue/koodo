import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../store";
import { useToast } from "../hooks/useToast";
import { data } from "../data";
import { api } from "../api";
import { requestLocation } from "../geo";
import { PROVIDERS, getProvider, feeFor, simulatePay, type ProviderId } from "../payments/providers";
import type { DeliveryInfo } from "../db/types";
import type { Offer } from "../types";

// VITE_PAYMENT_API=server : le paiement passe par le serveur
// (/api/payments/charge), qui initie le paiement réel CinetPay en
// production. Valeur absente/sandbox : simulation locale (aucune
// somme débitée, aucune clé requise).
const SERVER_PAYMENT = import.meta.env.VITE_PAYMENT_API === "server";

export default function PayScreen() {
  const { offerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const offers = useApp((s) => s.offers);
  const showToast = useToast((s) => s.show);

  const offer: Offer | undefined = offers.find((o) => o.id === offerId);
  const [providerId, setProviderId] = useState<ProviderId>("orange");
  const [qtyKg, setQtyKg] = useState<number>((location.state as any)?.qtyKg ?? offer?.quantity ?? 1);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"method" | "confirm">("method");

  if (!offer) {
    return (
      <div className="empty" style={{ marginTop: 20 }}>
        <p>Annonce introuvable ou expirée.</p>
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => navigate("/marche")}>Retour au marché</button>
      </div>
    );
  }

  const provider = getProvider(providerId);
  const o = offer;
  const maxKg = o.quantity;
  const qty = Math.min(Math.max(1, Number(qtyKg) || 1), maxKg);
  const amount = o.unit_price * qty;
  const fee = feeFor(amount, provider);
  const total = amount + fee;

  async function sendLocation() {
    try {
      const g = await requestLocation(true);
      if (g) {
        setDelivery({ lat: g.lat, lng: g.lng, label: g.label && g.label !== "…" ? g.label : `${g.lat}, ${g.lng}` });
        showToast("Localisation de livraison envoyée ✓");
      } else {
        showToast("Localisation refusée ou indisponible");
      }
    } catch {
      showToast("Impossible d'obtenir ta position");
    }
  }

  async function pay() {
    setBusy(true);
    try {
      // 1) Initiation du paiement Mobile Money (simulée en sandbox,
      //    CinetPay réel si VITE_PAYMENT_API=server + clés configurées)
      const ref = SERVER_PAYMENT
        ? (await api.post<{ ref: string }>("/payments/charge", { offerId: o.id, qtyKg: qty, provider: provider.id, phone, delivery: delivery || undefined })).ref
        : (await simulatePay({ provider, amount, phone })).ref;
      // 2) Enregistrement de la transaction (Firestore ou local en démo)
      const tx = await data.startPayment({
        offerId: o.id,
        amount,
        fee,
        providerId: provider.id,
        providerName: provider.name,
        buyerPhone: phone,
        ref,
        qtyKg: qty,
        delivery: delivery ? { ...delivery, note: note.trim() || undefined } : undefined,
      });
      // Le stock serveur a diminué → on rafraîchit le marché dans l'appli
      // (l'annonce disparaît du marché dès qu'elle atteint 0 kg).
      void data.listMarketOffers().then((o2) => useApp.getState().setOffers(o2)).catch(() => {});
      navigate(`/recu/${tx.id}`, { state: { ref: ref || tx.ref } });
    } catch (err: any) {
      showToast(err.message || "Paiement impossible — essaie encore");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="total-box">
        <div>
          <p style={{ margin: 0, fontSize: 11, color: "#B7E4C7" }}>{offer.emoji} {offer.crop_name} · {qty} kg / {o.quantity} kg disponibles</p>
          <p className="amount font-display">{amount.toLocaleString("fr-FR")} F CFA</p>
          {fee > 0 && <p className="fees">+ frais {provider.name} : {fee.toLocaleString("fr-FR")} F</p>}
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 11, color: "#B7E4C7" }}>Total à payer</p>
          <p className="amount font-display">{total.toLocaleString("fr-FR")} F</p>
        </div>
      </div>

      {step === "method" ? (
        <>
          <p className="section-label">Moyen de paiement</p>
          <div className="provider-list">
            {PROVIDERS.map((p) => (
              <div
                key={p.id}
                className={`provider-card ${providerId === p.id ? "selected" : ""}`}
                onClick={() => setProviderId(p.id)}
              >
                <div className="provider-logo" style={{ background: p.color }}>{p.logo}</div>
                <div>
                  <p className="p-name" style={{ margin: 0 }}>{p.name}</p>
                  <p className="p-desc" style={{ margin: 0 }}>{p.countries}</p>
                </div>
                <span className="provider-check">
                  {providerId === p.id && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}
                </span>
              </div>
            ))}
          </div>
          <button className="btn btn-green" style={{ marginTop: 16 }} onClick={() => setStep("confirm")}>
            Continuer avec {provider.name}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        </>
      ) : (
        <div className="form-card">
          <p className="section-label" style={{ marginTop: 0 }}>Confirmation — {provider.name}</p>
          <div className="field">
            <label>Masse que tu veux acheter (kg) — max {maxKg} kg</label>
            <div className="mini-qty" style={{ width: "100%" }}>
              <input
                className="qty-input"
                style={{ width: "100%" }}
                value={qtyKg}
                inputMode="decimal"
                onChange={(e) => setQtyKg(Number(e.target.value.replace(",", ".")) || 0)}
              />
              <span className="qty-unit">kg</span>
            </div>
          </div>
          <div className="field">
            <label>Ton numéro {provider.short} (celui qui paie)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex : 07 07 00 00 00" inputMode="tel" />
            <p style={{ fontSize: 11, color: "var(--muted2)", margin: "6px 0 0" }}>{provider.hint} · {provider.ussd}</p>
          </div>
          <div className="field">
            <label>Livraison / expédition</label>
            {delivery ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="live-dot"><span className="pulse" /></span>
                <span style={{ fontSize: 12 }}>📍 {delivery.label}</span>
                <button className="btn btn-danger-ghost btn-sm" onClick={() => setDelivery(null)}>×</button>
              </div>
            ) : (
              <button className="btn btn-ghost" style={{ width: "100%" }} onClick={sendLocation}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10a8 8 0 10-16 0c0 6 8 10 8 10z"/><circle cx="12" cy="12" r="3"/></svg>
                Envoyer ma position
              </button>
            )}
            {delivery && (
              <input style={{ marginTop: 8 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Précisions (ex : derrière la gare…)" />
            )}
          </div>
          <button className="btn btn-primary" onClick={pay} disabled={busy} style={{ opacity: busy ? .7 : 1 }}>
            {busy ? (
              <>
                <span className="sync spinning"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></span>
                Paiement en cours…
              </>
            ) : (
              <>Payer {total.toLocaleString("fr-FR")} F {SERVER_PAYMENT ? "" : <small>(sandbox)</small>}</>
            )}
          </button>
          <p style={{ fontSize: 11, color: "var(--muted2)", margin: "10px 0 0", textAlign: "center" }}>
            {SERVER_PAYMENT ? "Paiement initié par le serveur sécurisé — confirmation par SMS Webhook." : "Mode sandbox : aucun argent réel n'est débité."}
          </p>
        </div>
      )}

      <button className="btn btn-ghost" style={{ marginTop: 12, width: "100%" }} onClick={() => (step === "confirm" ? setStep("method") : navigate(-1))}>
        {step === "confirm" ? "← Changer de moyen de paiement" : "← Retour"}
      </button>
    </>
  );
}