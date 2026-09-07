import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { useCart } from "../cart";
import { useToast } from "../hooks/useToast";
import { data } from "../data";
import { api } from "../api";
import { requestLocation } from "../geo";
import { PROVIDERS, getProvider, feeFor, simulatePay, type ProviderId } from "../payments/providers";
import type { DeliveryInfo, TxItem } from "../db/types";

const SERVER_PAYMENT = import.meta.env.VITE_PAYMENT_API === "server";

export default function CartScreen() {
  const items = useCart((s) => s.items);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);
  const user = useApp((s) => s.user);
  const showToast = useToast((s) => s.show);
  const navigate = useNavigate();

  const [providerId, setProviderId] = useState<ProviderId>("orange");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const provider = getProvider(providerId);
  const products = items.reduce((s, i) => s + i.unitPrice * i.qtyKg, 0);
  const fee = feeFor(products, provider);
  const total = products + fee;

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
    if (!phone.replace(/\D/g, "").length) return showToast("Indique ton numéro Mobile Money");
    setBusy(true);
    try {
      const txItems: TxItem[] = items.map((i) => ({
        offerId: i.offerId,
        cropName: i.cropName,
        emoji: i.emoji,
        qtyKg: i.qtyKg,
        unitPrice: i.unitPrice,
        amount: Math.round(i.unitPrice * i.qtyKg),
      }));
      const deliveryPayload = delivery ? { ...delivery, note: note.trim() || undefined } : undefined;

      // Paiement Mobile Money (simulé en sandbox, serveur/CinetPay sinon).
      const ref = SERVER_PAYMENT
        ? (
            await api.post<{ ref: string }>("/payments/charge", {
              items: txItems.map((i) => ({ offerId: i.offerId, qtyKg: i.qtyKg })),
              provider: provider.id,
              phone,
              delivery: deliveryPayload,
            })
          ).ref
        : (await simulatePay({ provider, amount: total, phone })).ref;

      // Commande : enregistre la transaction (items + localisation de livraison).
      const tx = await data.checkout({
        items: txItems,
        amount: products,
        fee,
        providerId: provider.id,
        providerName: provider.name,
        buyerPhone: phone,
        ref,
        delivery: deliveryPayload,
      });
      clear();
      navigate(`/recu/${tx.id}`, { state: { ref, items: txItems, delivery: deliveryPayload } });
    } catch (err: any) {
      showToast(err.message || "Paiement impossible — essaie encore");
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="empty" style={{ marginTop: 24 }}>
        <div className="icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6h15l-2 9H8L5 3H2"/><circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/></svg>
        </div>
        <p>Ton panier est vide.</p>
        <p>Ajoute les récoltes que tu veux acheter depuis le marché.</p>
        <Link to="/marche" style={{ textDecoration: "none" }}>
          <button className="btn btn-primary" style={{ marginTop: 8 }}>Aller au marché</button>
        </Link>
      </div>
    );
  }

  return (
    <>
      <p className="section-label">
        Mon panier <span className="count">{items.length} article{items.length > 1 ? "s" : ""}</span>
      </p>

      <div className="list">
        {items.map((i) => (
          <div className="card cart-item" key={i.offerId}>
            {i.image && <img className="offer-thumb" src={i.image} alt={i.cropName} />}
            <div className="cart-info">
              <p style={{ margin: 0, fontSize: 13 }}>{i.emoji} {i.cropName}</p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>
                {i.seller} · {i.unitPrice.toLocaleString("fr-FR")} F/kg{i.village ? ` · ${i.village}` : ""}
              </p>
              <div className="qty-row">
                <button className="qty-btn" onClick={() => (i.qtyKg <= 1 ? remove(i.offerId) : setQty(i.offerId, i.qtyKg - 1))} aria-label="moins">
                  −
                </button>
                <input
                  className="qty-input"
                  value={i.qtyKg}
                  inputMode="decimal"
                  onChange={(e) => setQty(i.offerId, Number(e.target.value.replace(",", ".")) || 0)}
                />
                <button className="qty-btn" onClick={() => setQty(i.offerId, i.qtyKg + 1)} aria-label="plus">
                  +
                </button>
                <span className="qty-unit">kg</span>
                <span className="qty-total font-mono">{Math.round(i.unitPrice * i.qtyKg).toLocaleString("fr-FR")} F</span>
                <button className="qty-remove" onClick={() => remove(i.offerId)} aria-label="retirer">×</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Localisation pour livraison / expédition */}
      <p className="section-label">Livraison ou expédition</p>
      <div className="delivery-box">
        {delivery ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="live-dot"><span className="pulse" /></span>
              <span style={{ fontSize: 13 }}>📍 {delivery.label}</span>
              <button className="btn btn-danger-ghost btn-sm" onClick={() => setDelivery(null)}>×</button>
            </div>
            <input
              style={{ marginTop: 8 }}
              className="delivery-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Précisions pour la livraison (ex : derrière la gare, proche du marché…)"
            />
          </>
        ) : (
          <button className="btn btn-ghost" style={{ width: "100%" }} onClick={sendLocation}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10a8 8 0 10-16 0c0 6 8 10 8 10z"/><circle cx="12" cy="12" r="3"/></svg>
            Envoyer ma position (livraison)
          </button>
        )}{delivery && (
          <button className="btn btn-ghost" style={{ marginTop: 8, width: "100%" }} onClick={sendLocation}>
            Mettre à jour ma position
          </button>
        )}
      </div>

      {/* Totaux calculés automatiquement */}
      <div className="total-box">
        <div>
          <p style={{ margin: 0, fontSize: 11, color: "#B7E4C7" }}>
            {items.reduce((s, i) => s + i.qtyKg, 0).toLocaleString("fr-FR")} kg au total · {provider.name}
          </p>
          <p className="amount font-display">{total.toLocaleString("fr-FR")} F CFA</p>
          {fee > 0 && <p className="fees">+ frais {provider.name} : {fee.toLocaleString("fr-FR")} F</p>}
        </div>
      </div>

      <p className="section-label">Moyen de paiement</p>
      <div className="provider-list">
        {PROVIDERS.map((p) => (
          <div key={p.id} className={`provider-card ${providerId === p.id ? "selected" : ""}`} onClick={() => setProviderId(p.id)}>
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

      <div className="form-card" style={{ marginTop: 10 }}>
        <div className="field">
          <label>Ton numéro {provider.short} (celui qui paie)</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex : 07 07 00 00 00" inputMode="tel" />
        </div>
        <button className="btn btn-primary" onClick={pay} disabled={busy} style={{ marginTop: 8, opacity: busy ? .7 : 1 }}>
          {busy ? <><span className="sync spinning">…</span> Paiement en cours…</> : <>Valider et payer {total.toLocaleString("fr-FR")} F {SERVER_PAYMENT ? "" : <small>(sandbox)</small>}</>}
        </button>
      </div>

      <p style={{ fontSize: 11, color: "var(--muted2)", margin: "10px 0 0", textAlign: "center" }}>
        {SERVER_PAYMENT ? "Paiement initié par le serveur sécurisé." : "Mode sandbox : aucun argent réel n'est débité."} · Le prix est recalculé automatiquement selon les quantités.
      </p>
    </>
  );
}