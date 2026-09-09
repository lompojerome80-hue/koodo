import { useState, useEffect } from "react";
import { useApp } from "../store";
import { useToast } from "../hooks/useToast";
import { data } from "../data";
import { persistGeo, applyGeoToField } from "../geo";
import { getProvider } from "../payments/providers";
import type { BuyerOrder } from "../types";

const COURSE_LABEL: Record<string, string> = {
  open: "🟡 livreur à trouver",
  accepted: "🔵 récupération du colis",
  picked_up: "🟣 en livraison",
  done: "✅ livrée",
  cancelled: "✖️ annulée",
};

export default function SellScreen() {
  const user = useApp((s) => s.user);
  const crops = useApp((s) => s.crops);
  const myOffers = useApp((s) => s.myOffers);
  const setMyOffers = useApp((s) => s.setMyOffers);
  const online = useApp((s) => s.online);
  const showToast = useToast((s) => s.show);

  const [cropId, setCropId] = useState("mais");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [loc, setLoc] = useState("");
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const [geolocating, setGeolocating] = useState(false);
  const [purchases, setPurchases] = useState<BuyerOrder[] | null>(null);
  const [releaseBusy, setReleaseBusy] = useState("");

  useEffect(() => {
    if (!loc) setLoc(applyGeoToField("latlng"));
  }, []);

  /** Redimensionne une photo choisie (max 700 px, JPEG) pour des annonces légères. */
  function onPickPhoto(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 700;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        setPhoto(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function locate() {
    setGeolocating(true);
    try {
      if (!navigator.geolocation) { showToast("Géolocalisation non supportée"); return; }
      const pos: GeolocationPosition = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
      });
      setLoc(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
      void persistGeo(pos.coords.latitude, pos.coords.longitude);
      showToast("Position récupérée pour les acheteurs ✓");
    } catch {
      showToast("Position non disponible — pas grave");
    } finally {
      setGeolocating(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(qty);
    const p = Number(price);
    if (!q || !p) return showToast("Renseigne quantité et prix");
    setBusy(true);
    try {
      const coords = loc.split(",").map((s) => Number(s.trim()));
      const offer = await data.createOffer({
        cropId,
        quantity: q,
        unitPrice: p,
        lat: coords.length === 2 ? coords[0] : null,
        lng: coords.length === 2 ? coords[1] : null,
        image: photo || undefined,
      });
      setMyOffers([offer, ...myOffers.filter((o) => o.id !== offer.id)]);
      setQty(""); setPrice(""); setLoc(""); setPhoto("");
      showToast(online ? "Annonce publiée ✓" : "Annonce publiée — envoi dès que le réseau revient ✓");
    } catch (err: any) {
      showToast(err.message || "Impossible de publier");
    } finally {
      setBusy(false);
    }
  }

  async function markSold(id: string) {
    try {
      await data.markOfferStatus(id, "sold");
      setMyOffers(myOffers.map((o) => (o.id === id ? { ...o, status: "sold" } : o)));
      showToast("Annonce marquée comme vendue ✓");
    } catch {
      showToast("Action impossible pour le moment");
    }
  }

  async function loadPurchases() {
    try {
      setPurchases(await data.listMyPurchases());
    } catch {
      setPurchases([]);
    }
  }

  // Les achats se chargent tout seuls pour l'acheteur (bouton = recharger).
  useEffect(() => {
    if (user?.role && user.role !== "producer") void loadPurchases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function releaseFunds(o: BuyerOrder) {
    setReleaseBusy(o.txId);
    try {
      await data.confirmDelivery(o.txId);
      showToast("Fonds libérés au vendeur ✓");
      await loadPurchases();
    } catch (err: any) {
      showToast(err.message || "Libération impossible");
    } finally {
      setReleaseBusy("");
    }
  }

  const isSeller = user?.role === "producer";

  return (
    <>
      {isSeller ? (
        <>
          <p className="section-label">Proposer ta récolte</p>
          <form className="form-card" onSubmit={submit}>
            <div className="field">
              <label>Culture</label>
              <select value={cropId} onChange={(e) => setCropId(e.target.value)}>
                {crops.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Quantité (kg)</label>
                <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="ex : 80" />
              </div>
              <div className="field">
                <label>Prix (F CFA/kg)</label>
                <input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="ex : 300" />
              </div>
            </div>
            <div className="field">
              <label>Position {loc && <span style={{ color: "var(--green-2)" }}>✓ {loc}</span>}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="lat, lng — ou localisation auto" style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={locate} disabled={geolocating} style={{ whiteSpace: "nowrap" }}>
                  {geolocating ? "…" : "Localiser"}
                </button>
              </div>
            </div>
            <div className="field">
              <label>Photo du produit</label>
              {photo ? (
                <div className="photo-preview">
                  <img src={photo} alt="Aperçu de la photo du produit" />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhoto("")}>Retirer</button>
                </div>
              ) : (
                <label className="photo-pick">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  <span>Ajouter une photo (optionnel)</span>
                  <input type="file" accept="image/*" onChange={(e) => onPickPhoto(e.target.files?.[0])} hidden />
                </label>
              )}
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy} style={{ opacity: busy ? .7 : 1 }}>
              Publier l'annonce
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6"/></svg>
            </button>
            {!online && (
              <p style={{ fontSize: 11, color: "var(--alert)", display: "flex", gap: 5, alignItems: "center", margin: "8px 0 0" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.58 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>
                Hors ligne : ton annonce sera envoyée dès le retour du réseau.
              </p>
            )}
          </form>

          <div className="section-label">Mes annonces <span className="count">{myOffers.length}</span></div>
          {myOffers.length === 0 ? (
            <div className="empty">
              <div className="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg></div>
              <p>Aucune annonce pour le moment.</p>
              <p>Publie ta récolte pour la proposer directement aux acheteurs, sans intermédiaire.</p>
            </div>
          ) : (
            <div className="list">
              {myOffers.map((o) => (
                <div className="card offer-card" key={o.id}>
                  {o.image && <img className="offer-thumb" src={o.image} alt={o.crop_name} />}
                  <div className="left">
                    <p>{o.emoji} {o.crop_name} — {o.quantity} kg</p>
                    <p className="font-mono">{o.unit_price.toLocaleString("fr-FR")} F CFA/kg</p>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <span className={`pill ${o.status === "open" ? "open" : o.status === "pending" ? "pending" : "sold"}`}>
                      {o.status === "sold" ? "vendue" : o.status === "pending" ? "en attente" : "en ligne"}
                    </span>
                    {o.status === "open" && (
                      <button className="btn btn-ghost btn-sm" onClick={() => markSold(o.id)}>Marquer vendue</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="section-label">Mes achats</p>
          <p className="info-card">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: "-2px", display: "inline", marginRight: 6 }}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0"/></svg>
            Tes paiements Mobile Money réussis apparaissent ici avec leur référence.
          </p>
          <button className="btn btn-ghost" style={{ marginBottom: 14, width: "100%" }} onClick={loadPurchases}>Voir mes achats</button>
          {(purchases || []).length === 0 ? (
            <div className="empty">
              <div className="icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12V8H6a2 2 0 01-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 000 4h4v-4h-4z"/></svg></div>
              <p>Aucun achat pour le moment.</p>
              <p>Ouvre une annonce dans l'onglet Marché et paie par Mobile Money (Orange Money, MTN, Wave, Moov).</p>
            </div>
          ) : (
            <div className="list">
              {(purchases || []).map((t) => (
                <div className="card offer-card" key={t.txId} style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div className="left">
                      <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="provider-logo" style={{ width: 30, height: 30, borderRadius: 8, background: getProvider(t.provider).color, fontSize: 9 }}>{getProvider(t.provider).logo}</span>
                        {getProvider(t.provider).name}
                      </p>
                      <p className="font-mono">{t.amount.toLocaleString("fr-FR")} F CFA</p>
                      <p style={{ fontSize: 11, color: "var(--muted)" }} className="font-mono">Réf : {t.reference || t.txId}</p>
                    </div>
                    {t.disputed ? (
                      <span className="pill pending">⚠️ litige</span>
                    ) : t.status === "delivered" ? (
                      <span className="pill open">fonds libérés</span>
                    ) : t.releaseable ? (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={releaseBusy === t.txId}
                        style={{ opacity: releaseBusy === t.txId ? .7 : 1 }}
                        onClick={() => releaseFunds(t)}
                      >
                        {releaseBusy === t.txId ? "Libération…" : "🔓 Libérer les fonds"}
                      </button>
                    ) : (
                      <span className="pill pending">🚚 course en cours</span>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
                    {t.items.map((it) => it.cropName).join(" · ") || "Produit"} — {t.sellerName || "vendeur"}
                  </p>
                  {t.deliveryMove && (
                    <p style={{ fontSize: 11, color: "var(--muted2)", margin: 0 }}>
                      📦 {COURSE_LABEL[t.deliveryMove.status] || "livraison"}{t.deliveryMove.courierName ? ` · ${t.deliveryMove.courierName}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}