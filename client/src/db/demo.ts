import { api, setToken, getToken } from "../api";
import { offline } from "../offline";
import { useApp } from "../store";
import { flushOfflineQueue } from "../sync";
import { seedPricesFor, jitterRows } from "./seed";
import { makeTicketRef } from "../payments/providers";
import type { DataBackend, NewOffer, RegisterInput, StartPaymentInput, CheckoutInput } from "./types";
import type { Crop, Offer, PriceRow, TrendRow, User, Alert, CourseDelivery, CourierDues, CreateDeliveryInput, CourierDossier, AppNotification, AdminCourier, AdminPayment, SellerOrder, NearbyCourier, AssignOrderInput } from "../types";
import { nanoid } from "nanoid";

// Décrémente le stock serveur après un achat (mode démo / Express).
async function consumeOffer(offerId: string, qtyKg: number) {
  await api.post("/offers/consume", { offerId, qtyKg });
}

// Persiste l'achat côté serveur sous statut "escrow" (fonds mis en attente
// jusqu'à confirmation de la livraison par l'acheteur). Meilleur effort.
async function recordEscrow(
  txId: string,
  items: { offerId: string; qtyKg: number; amount: number }[],
  total: number,
  provider: string,
  ref: string,
  buyerPhone: string,
  delivery?: import("./types").DeliveryInfo
) {
  await api.post("/payments/register", {
    txId,
    items,
    amount: total,
    fee: 0,
    provider,
    ref,
    buyerPhone,
    delivery,
  });
}

function mapOffer(o: any): Offer {
  return {
    id: o.id,
    crop_id: o.crop_id,
    crop_name: o.crop_name || o.crop_id,
    emoji: o.emoji,
    quantity: Number(o.quantity),
    unit_price: Number(o.unit_price),
    status: o.status,
    created_at: o.created_at,
    seller: o.seller,
    village: o.village,
    region: o.region,
    lat: o.location_lat,
    lng: o.location_lng,
    image: o.image,
  };
}

function mapUser(u: any): User {
  return {
    id: u.id,
    full_name: u.full_name,
    phone: u.phone,
    email: u.email ?? null,
    auth_provider: u.auth_provider ?? "sms",
    role: u.role,
    region: u.region ?? null,
    village: u.village ?? null,
    verified: u.verified ?? 0,
    ussd_code: u.ussd_code ?? null,
    blocked: u.blocked ?? 0,
    blocked_reason: u.blocked_reason ?? null,
    locality: u.locality ?? null,
    transport: u.transport ?? null,
    selfie: u.selfie ?? null,
    id_front: u.id_front ?? null,
    id_back: u.id_back ?? null,
    doc_status: u.doc_status ?? "pending",
    doc_updated_at: u.doc_updated_at ?? null,
  };
}

function mapDelivery(d: any): CourseDelivery {
  return {
    id: d.id,
    tx_ref: d.tx_ref,
    title: d.title,
    package: d.package,
    seller_id: d.seller_id,
    seller_name: d.seller_name,
    courier_id: d.courier_id,
    courier_name: d.courier_name,
    courier_photo: d.courier_photo ?? null,
    courier_transport: d.courier_transport ?? null,
    courier_locality: d.courier_locality ?? null,
    courier_verified: d.courier_verified ?? 0,
    seller_label: d.seller_label,
    seller_lat: d.seller_lat,
    seller_lng: d.seller_lng,
    buyer_label: d.buyer_label,
    buyer_lat: d.buyer_lat,
    buyer_lng: d.buyer_lng,
    buyer_phone: d.buyer_phone,
    price_fee: Number(d.price_fee),
    status: d.status,
    pickup_code: d.pickup_code,
    delivery_code: d.delivery_code,
    distanceKm: d.distanceKm ?? null,
    created_at: d.created_at,
    accepted_at: d.accepted_at,
    picked_at: d.picked_at,
    delivered_at: d.delivered_at,
  };
}

export const demoBackend: DataBackend = {
  isDemo: true,

  async getCrops() {
    try {
      const rows = await api.get<Crop[]>("/market/crops");
      if (rows.length) {
        useApp.getState().setCrops(rows);
        return rows;
      }
    } catch { /* offline */ }
    return useApp.getState().crops;
  },

  async register(input: RegisterInput) {
    const res = await api.post<{ token: string; user: any }>("/auth/register", {
      fullName: input.fullName,
      phone: input.phone,
      password: input.password,
      role: input.role,
      region: input.region,
      village: input.village,
      locality: input.locality,
      transport: input.transport,
      selfie: input.selfie,
      id_front: input.id_front,
      id_back: input.id_back,
    });
    setToken(res.token);
    return mapUser(res.user);
  },

  async login(identifier: string, password: string) {
    const res = await api.post<{ token: string; user: any }>("/auth/login", {
      phone: identifier,
      password,
    });
    setToken(res.token);
    return mapUser(res.user);
  },

  async logout() {
    setToken(null);
  },

  async googleLogin() {
    // Mode démo : simulation Google (identité fixe et reproductible). Le vrai
    // Google reste disponible avec Firebase (client/.env renseigné).
    const res = await api.post<{
      existing: boolean;
      draftToken?: string;
      draftName?: string;
      draftEmail?: string;
      user?: any;
      token?: string;
    }>("/auth/google/draft", {
      name: "Ibrahim Ouattara",
      email: "ibrahim.ouattara.demo@gmail.com",
      phone: "+2260701000097",
    });
    if (res.existing && res.user && res.token) {
      setToken(res.token);
      return { user: mapUser(res.user), draftName: "", draftPhone: "", draftPhoto: null };
    }
    return {
      user: null,
      draftName: res.draftName || "Ibrahim Ouattara",
      draftPhone: "+2260701000097",
      draftPhoto: null,
      draftToken: res.draftToken,
    };
  },

  async completeGoogleProfile(input: import("./types").GoogleProfileInput) {
    const res = await api.post<{ token: string; user: any }>("/auth/google/register", {
      draftToken: input.draftToken,
      fullName: input.name,
      phone: input.phone,
      role: input.role,
      region: input.region,
      village: input.village,
      locality: input.locality,
      transport: input.transport,
      selfie: input.selfie,
      id_front: input.id_front,
      id_back: input.id_back,
    });
    setToken(res.token);
    return mapUser(res.user);
  },

  async updateCourierDossier(input: CourierDossier) {
    const res = await api.patch<{ ok: boolean; user: any }>("/auth/me/courier", {
      locality: input.locality,
      transport: input.transport,
      selfie: input.selfie,
      id_front: input.id_front,
      id_back: input.id_back,
    });
    return mapUser(res.user);
  },

  async restoreSession() {
    if (!getToken()) return null;
    try {
      const res = await api.get<{ user: any }>("/auth/me");
      if (!res?.user) { setToken(null); return null; }
      return mapUser(res.user);
    } catch {
      // token invalide / offline : on le garde pour une réauthentification plus tard
      return null;
    }
  },

  async refreshUser(id: string) {
    try {
      const res = await api.get<{ user: any }>("/auth/me");
      return mapUser(res.user);
    } catch {
      return null;
    }
  },

  subscribePrices(cropId: string, cb: (rows: PriceRow[]) => void): () => void {
    let rows: PriceRow[] | null = null;
    let stopped = false;

    const apply = (r: PriceRow[]) => { rows = r; if (!stopped) cb(r); };

    const fetchOnce = async (): Promise<PriceRow[]> => {
      try {
        const res = await api.get<{ prices: PriceRow[] }>(`/market/prices?crop=${cropId}`);
        const sorted = [...res.prices].sort((a, b) => a.price - b.price);
        await offline.cachePrices(cropId, sorted);
        return sorted;
      } catch {
        const cached = await offline.cachedPrices(cropId);
        if (cached?.data?.length) return cached.data as PriceRow[];
        return seedPricesFor(cropId);
      }
    };

    void fetchOnce().then(apply);

    const timer = setInterval(async () => {
      // 1 tick / 2 : rafraîchit depuis le serveur, sinon légère variation (prix "vivants")
      if (Math.random() < 0.5) {
        const fresh = await fetchOnce().catch(() => null);
        if (fresh) return apply(fresh);
      }
      if (rows) apply(jitterRows(rows));
    }, 25000);

    return () => { stopped = true; clearInterval(timer); };
  },

  async getTrend(cropId: string) {
    try {
      return await api.get<TrendRow[]>(`/market/trend?crop=${cropId}`);
    } catch {
      return [];
    }
  },

  async reportPrice(cropId: string, marketId: string, price: number) {
    const res = await api.post<{ ok: boolean; status: "published" | "pending"; price?: number; count?: number; reportsNeeded?: number }>(
      "/market/report",
      { cropId, marketId, price }
    );
    return {
      status: res.status || "pending",
      confirmedBy: res.count || 0,
      reportsNeeded: res.reportsNeeded || 2,
      price: res.price,
    };
  },

  async createOffer(input: NewOffer) {
    const me = useApp.getState().user;
    const crops = useApp.getState().crops;
    const crop = crops.find((c) => c.id === input.cropId);
    const id = nanoid();
    const base: Offer = {
      id,
      crop_id: input.cropId,
      crop_name: crop?.name || input.cropId,
      emoji: crop?.emoji,
      quantity: input.quantity,
      unit_price: input.unitPrice,
      status: "open",
      created_at: new Date().toISOString(),
      seller: me?.full_name,
      village: me?.village || "",
      region: me?.region || "",
      lat: input.lat ?? undefined,
      lng: input.lng ?? undefined,
      image: input.image,
    };

    // Publication optimiste : l'annonce est visible « en ligne » dès maintenant.
    // Elle part pour le serveur en arrière-plan ; si le réseau est lent ou le
    // serveur endormi, elle reste dans la file et sera renvoyée automatiquement.
    await offline.queueOffer({ id, cropId: input.cropId, quantity: input.quantity, unitPrice: input.unitPrice, createdAt: base.created_at, image: input.image });
    await offline.saveOfferLocal({ id, cropId: input.cropId, quantity: input.quantity, unitPrice: input.unitPrice, createdAt: base.created_at, image: input.image });
    useApp.getState().setPendingSync((await offline.listQueue()).length);
    void flushOfflineQueue();
    return base;
  },

  async listMarketOffers() {
    const rows = await api.get<any[]>("/offers");
    return rows.map(mapOffer);
  },

  async listMyOffers() {
    let server: Offer[] = [];
    try {
      server = (await api.get<any[]>("/offers?mine=1")).map(mapOffer);
    } catch {
      /* hors ligne : on se rabat sur la file locale */
    }
    const queued = await offline.localOffers();
    // Toute annonce encore en file (pas encore partie) reste visible « en ligne » :
    // elle sera envoyée dès que le réseau le permet. Le serveur fait foi si connue.
    const map = new Map(server.map((o) => [o.id, o]));
    for (const l of queued) {
      if (map.has(l.id)) continue;
      const crops = useApp.getState().crops;
      const c = crops.find((x) => x.id === l.cropId);
      map.set(l.id, {
        id: l.id,
        crop_id: l.cropId,
        crop_name: c?.name || l.cropId,
        emoji: c?.emoji,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        status: "open" as const,
        created_at: l.createdAt,
        image: l.image,
      });
    }
    return [...map.values()];
  },

  async markOfferStatus(id: string, status: "open" | "sold" | "cancelled") {
    await api.patch(`/offers/${id}`, { status });
  },

  async listThreads() {
    return await api.get<any[]>("/messages/threads");
  },

  async getMessages(offerId: string) {
    return await api.get<any[]>(`/messages/${offerId}`);
  },

  async sendMessage(offerId: string, body: string, voice?: { audio: string; duration: number }) {
    if (voice) await api.post(`/messages/${offerId}`, { audio: voice.audio, duration: voice.duration });
    else await api.post(`/messages/${offerId}`, { body });
  },

  async markMessagesRead(offerId: string) {
    await api.post(`/messages/${offerId}/read`, {});
  },

  async deleteMessage(offerId: string, messageId: string) {
    await api.del(`/messages/${offerId}/${messageId}`);
  },

  async listAlerts() {
    return await api.get<Alert[]>("/alerts");
  },

  async createAlert(cropId: string, targetPrice: number) {
    return await api.post<Alert>("/alerts", { cropId, targetPrice });
  },

  async deleteAlert(id: string) {
    await api.del(`/alerts/${id}`);
  },

  async startPayment(input: StartPaymentInput) {
    const me = useApp.getState().user;
    const total = input.amount + input.fee;
    const tx = {
      id: nanoid(),
      offer_id: input.offerId,
      provider: input.providerId,
      provider_name: input.providerName,
      amount: input.amount,
      fee: input.fee,
      total,
      buyer_id: me?.id || "anonymous",
      buyer_name: me?.full_name || "Client",
      buyer_phone: input.buyerPhone,
      status: "completed" as const,
      ref: input.ref || makeTicketRef(input.providerId),
      qtyKg: input.qtyKg,
      delivery: input.delivery,
      order_status: "escrow" as const,
      created_at: new Date().toISOString(),
    };
    await new Promise<void>((resolve) => setTimeout(resolve, 1400));
    await offline.savePurchase(tx);
    recordEscrow(tx.id, [{ offerId: input.offerId, qtyKg: input.qtyKg || 1, amount: input.amount }], total, input.providerId, tx.ref, input.buyerPhone, tx.delivery).catch(() => {});
    // Décrémente le stock serveur (meilleur effort — silencieux hors ligne).
    if (input.qtyKg) consumeOffer(input.offerId, input.qtyKg).catch(() => {});
    return tx;
  },

  async checkout(input: CheckoutInput) {
    const me = useApp.getState().user;
    const tx = {
      id: nanoid(),
      offer_id: input.items[0]?.offerId || "",
      items: input.items,
      provider: input.providerId,
      provider_name: input.providerName,
      amount: input.amount,
      fee: input.fee,
      total: input.amount + input.fee,
      buyer_id: me?.id || "anonymous",
      buyer_name: me?.full_name || "Client",
      buyer_phone: input.buyerPhone,
      status: "completed" as const,
      ref: input.ref || makeTicketRef(input.providerId),
      delivery: input.delivery,
      order_status: "escrow" as const,
      created_at: new Date().toISOString(),
    };
    await new Promise<void>((resolve) => setTimeout(resolve, 1400));
    await offline.savePurchase(tx);
    recordEscrow(tx.id, input.items, tx.total, input.providerId, tx.ref, input.buyerPhone, tx.delivery).catch(() => {});
    for (const it of input.items) consumeOffer(it.offerId, it.qtyKg).catch(() => {});
    return tx;
  },

  async confirmDelivery(txId: string) {
    await api.post("/payments/confirm", { txId });
    const all = await offline.listPurchases();
    const p = all.find((x) => x.id === txId);
    if (p) await offline.savePurchase({ ...p, order_status: "delivered" });
  },

  async openDispute(txId: string, reason: string) {
    await api.post("/payments/dispute", { txId, reason });
    const all = await offline.listPurchases();
    const p = all.find((x) => x.id === txId);
    if (p) await offline.savePurchase({ ...p, order_status: "disputed" });
  },

  async listSellerEscrow() {
    return await api.get<import("./types").SellerEscrow>("/payments/escrow");
  },

  async listSellerOrders() {
    const res = await api.get<{ orders: SellerOrder[] }>("/payments/orders");
    return res.orders;
  },

  async listMyPurchases() {
    const res = await api.get<{ purchases: import("../types").BuyerOrder[] }>("/payments/purchases");
    return res.purchases;
  },

  async listNearbyCouriers(lat?: number | null, lng?: number | null) {
    const q = lat != null && lng != null ? `?lat=${lat}&lng=${lng}` : "";
    const res = await api.get<{ couriers: NearbyCourier[] }>(`/deliveries/couriers${q}`);
    return res.couriers;
  },

  async assignOrderToCourier(input: AssignOrderInput) {
    const res = await api.post<{ delivery: any }>("/deliveries/assign", {
      txId: input.txId,
      courierId: input.courierId,
      priceFee: input.priceFee,
      seller_lat: input.sellerLat ?? null,
      seller_lng: input.sellerLng ?? null,
      seller_label: input.sellerLabel,
    });
    return mapDelivery(res.delivery);
  },

  async listTransactions() {
    const me = useApp.getState().user;
    const all = await offline.listPurchases();
    return all
      .filter((t) => me && t.buyer_id === me.id)
      .map((t) => ({ ...t, status: t.status as "pending" | "completed" | "failed" }));
  },

  async listOpenDeliveries(lat?: number | null, lng?: number | null) {
    const q = lat != null && lng != null ? `?lat=${lat}&lng=${lng}` : "";
    const res = await api.get<{ deliveries: CourseDelivery[] }>(`/deliveries/open${q}`);
    return res.deliveries.map(mapDelivery);
  },

  async createDelivery(input: CreateDeliveryInput) {
    const res = await api.post<{ delivery: any }>("/deliveries", input);
    return mapDelivery(res.delivery);
  },

  async listMyDeliveries() {
    const res = await api.get<{ deliveries: any[] }>("/deliveries/mine");
    return res.deliveries.map(mapDelivery);
  },

  async acceptDelivery(id: string) {
    const res = await api.post<{ delivery: any }>(`/deliveries/${id}/accept`, {});
    return mapDelivery(res.delivery);
  },

  async cancelDelivery(id: string) {
    await api.post<{ ok: boolean }>(`/deliveries/${id}/cancel`, {});
  },

  async pickupDelivery(id: string, pickupCode: string) {
    const res = await api.post<{ delivery: any }>(`/deliveries/${id}/pickup`, { pickupCode });
    return mapDelivery(res.delivery);
  },

  async completeDelivery(id: string, deliveryCode: string) {
    const res = await api.post<{ delivery: any; commission: number; dueToday: number }>(
      `/deliveries/${id}/complete`,
      { deliveryCode }
    );
    return { delivery: mapDelivery(res.delivery), commission: res.commission, dueToday: res.dueToday };
  },

  async deliveryForMe() {
    const res = await api.get<{ delivery: any | null }>("/deliveries/for-me");
    return res.delivery ? mapDelivery(res.delivery) : null;
  },

  async courierDues() {
    return await api.get<CourierDues>("/deliveries/dues");
  },

  async settleDues(receiptImage?: string) {
    return await api.post<CourierDues>("/deliveries/dues/settle", {
      receipt_image: receiptImage || null,
    });
  },

  async adminListCouriers() {
    const res = await api.get<{ couriers: AdminCourier[] }>("/admin/couriers");
    return res.couriers;
  },

  async adminVerifyCourier(id: string) {
    await api.post(`/admin/couriers/${id}/verify`, {});
  },

  async adminListPayments() {
    const res = await api.get<{ payments: AdminPayment[] }>("/admin/payments");
    return res.payments;
  },

  async adminConfirmPayment(id: string) {
    await api.post(`/admin/payments/${id}/confirm`, {});
  },

  async listNotifications() {
    const res = await api.get<{ notifications: AppNotification[] }>("/notifications");
    return res.notifications;
  },

  async markNotificationsRead() {
    await api.post("/notifications/read", {});
  },

  async supportListThreads() {
    const res = await api.get<{ threads: import("./types").SupportThread[] }>("/support/threads");
    return res.threads;
  },

  async supportCreateThread(subject: string, body: string) {
    const res = await api.post<{ thread: import("./types").SupportThread }>("/support/threads", { subject, body });
    return res.thread;
  },

  async supportListMessages(threadId: string) {
    const res = await api.get<{ messages: import("./types").SupportMsg[] }>(`/support/threads/${threadId}/messages`);
    return res.messages;
  },

  async supportSendMessage(threadId: string, body: string) {
    const res = await api.post<{ messages: import("./types").SupportMsg[] }>(`/support/threads/${threadId}/messages`, { body });
    return res.messages;
  },

  async adminSupportList() {
    const res = await api.get<{ threads: import("./types").AdminSupportThread[] }>("/admin/support");
    return res.threads;
  },

  async adminSupportMessages(threadId: string) {
    const res = await api.get<{ messages: import("./types").SupportMsg[] }>(`/admin/support/${threadId}/messages`);
    return res.messages;
  },

  async adminSupportReply(threadId: string, body: string) {
    await api.post(`/admin/support/${threadId}/messages`, { body });
  },
};