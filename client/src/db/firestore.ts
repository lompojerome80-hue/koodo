import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
  enableIndexedDbPersistence,
  type QuerySnapshot,
} from "firebase/firestore";
import { nanoid } from "nanoid";
import { firebaseApp, isFirebaseConfigured } from "../firebase/config";
import {
  fbSignup,
  fbLogin,
  fbLogout,
  mapFirebaseUser,
  type FBUser,
} from "../firebase/auth";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from "firebase/storage";
import { SEED_CROPS, SEED_MARKETS, seedPricesFor } from "./seed";
import { makeTicketRef } from "../payments/providers";
import type { DataBackend, NewOffer, RegisterInput, StartPaymentInput, CheckoutInput, GoogleProfileInput } from "./types";
import type { Crop, Offer, PriceRow, TrendRow, User, Alert, CourseDelivery, CourierDues, CourierDueDay, CreateDeliveryInput, AppNotification, AdminCourier, AdminPayment, SellerOrder, BuyerOrder, NearbyCourier, AssignOrderInput } from "../types";

let _db: ReturnType<typeof getFirestore> | null = null;
let _auth: ReturnType<typeof getAuth> | null = null;
export function dbc() {
  if (!isFirebaseConfigured()) throw new Error("Firebase n'est pas configurÃ©");
  if (!_db) _db = getFirestore(firebaseApp());
  return _db;
}
export function authc() {
  if (!isFirebaseConfigured()) throw new Error("Firebase non configuré — renseigne VITE_FIREBASE_*");
  if (!_auth) _auth = getAuth(firebaseApp());
  return _auth;
}

let _stg: ReturnType<typeof getStorage> | null = null;
function stgc() {
  if (!_stg) _stg = getStorage(firebaseApp());
  return _stg;
}

// Déplace les photos (base64 depuis le mobile) vers Firebase Storage et
// renvoie l'URL publique. Les URLs déjà données (Storage/HTTP) sont conservées.
async function uploadImg(dataUrl: string | null | undefined, kind: string): Promise<string | null> {
  if (!dataUrl) return null;
  if (!dataUrl.startsWith("data:")) return dataUrl;
  const uid = authc().currentUser?.uid || "anon";
  const m = dataUrl.match(/^data:image\/(\w+);base64,/);
  const ext = m && m[1] === "png" ? "png" : m && m[1] === "webp" ? "webp" : "jpg";
  const fileRef = storageRef(stgc(), `koodo/${uid}/${kind}-${Date.now()}.${ext}`);
  await uploadString(fileRef, dataUrl, "data_url");
  return getDownloadURL(fileRef);
}
try {
  enableIndexedDbPersistence(dbc()).catch(() => {
    /* persistance dÃ©jÃ  activÃ©e ou non supportÃ©e â€” silencieux */
  });
} catch {
  /* ignore */
}

let current: User | null = null;
let seededPromise: Promise<void> | null = null;

const FIELD_MAP: Record<string, string> = {
  full_name: "fullName",
  phone: "phone",
  role: "role",
  region: "region",
  village: "village",
  verified: "verified",
  ussd_code: "ussdCode",
  blocked: "blocked",
  blocked_reason: "blockedReason",
};

function fromFirestore<T>(id: string, data: any, fields: Record<string, string>): T {
  const out: any = { id };
  for (const [k, f] of Object.entries(fields)) out[k] = data?.[f] ?? null;
  return out;
}

const REPORTS_TO_PUBLISH = 2;

// Groupe de prix concordants : valeurs dans une fourchette de 5 % (min 100 F)
// autour de la médiane — le prix publié est la moyenne de ce groupe.
function clusterOf(raw: number[]): number[] {
  const prices = [...raw].sort((a, b) => a - b);
  if (!prices.length) return [];
  const median = prices[Math.floor(prices.length / 2)];
  const tol = Math.max(Math.round(median * 0.05), 100);
  return prices.filter((p) => Math.abs(p - median) <= tol);
}

async function ensureSeeded() {
  if (seededPromise) return seededPromise;
  seededPromise = (async () => {
    const cropsSnap = await getDocs(query(collection(dbc(), "crops")));
    if (cropsSnap.docs.length === 0) {
      const batch: Promise<unknown>[] = [];
const markets = SEED_MARKETS.map((m) => ({
        name: m.name,
        region: m.region,
        lat: m.lat,
        lng: m.lng,
      }));
      markets.forEach((m, i) => {
        batch.push(setDoc(doc(dbc(), "markets", SEED_MARKETS[i].id), { ...m, createdAt: serverTimestamp() }));
      });
      SEED_CROPS.forEach((c) => {
        batch.push(setDoc(doc(dbc(), "crops", c.id), { name: c.name, unit: c.unit, emoji: c.emoji, createdAt: serverTimestamp() }));
      });
      for (const crop of SEED_CROPS) {
        for (const row of seedPricesFor(crop.id)) {
          batch.push(
            setDoc(doc(dbc(), "prices", `${crop.id}_${row.market_id}`), {
              cropId: crop.id,
              marketId: row.market_id,
              marketName: row.market,
              distance: row.distance,
              lat: row.lat,
              lng: row.lng,
              min: row.min_price,
              max: row.max_price,
              avg: row.price,
              updatedAt: serverTimestamp(),
            })
          );
        }
      }
      await Promise.all(batch);
    }
  })();
  return seededPromise;
}

function mapPrice(doc: any): PriceRow {
  const d = doc.data();
  return {
    market_id: d.marketId,
    market: d.marketName,
    price: d.avg,
    min_price: d.min,
    max_price: d.max,
    distance: d.distance ?? 0,
    lat: d.lat,
    lng: d.lng,
    source: d.source,
  };
}

function mapOffer(id: string, d: any): Offer {
  return {
    id,
    crop_id: d.cropId,
    crop_name: d.cropName || d.cropId,
    emoji: d.emoji,
    quantity: Number(d.quantity),
    unit_price: Number(d.unitPrice),
    status: d.status || "open",
    created_at: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : String(d.createdAt || ""),
    seller: d.sellerName,
    village: d.village || "",
    region: d.region || "",
lat: d.lat,
    lng: d.lng,
    image: d.image,
  };
}

export async function userDoc(uid: string): Promise<User | null> {
  const snap = await getDoc(doc(dbc(), "users", uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    id: uid,
    full_name: d.fullName,
    phone: d.phone,
    email: d.email ?? null,
    auth_provider: d.authProvider ?? "sms",
    role: d.role || "producer",
    region: d.region ?? null,
    village: d.village ?? null,
    verified: d.verified ?? 0,
    ussd_code: d.ussdCode ?? null,
    blocked: d.blocked ?? 0,
    blocked_reason: d.blockedReason ?? null,
    locality: d.locality ?? null,
    transport: d.transport ?? null,
    selfie: d.selfie ?? null,
    id_front: d.idFront ?? null,
    id_back: d.idBack ?? null,
    doc_status: d.docStatus ?? "pending",
    doc_updated_at: d.docUpdatedAt ?? null,
  };
}

const DELIVERY_FIELDS: Record<string, string> = {
  seller_id: "sellerId",
  courier_id: "courierId",
  seller_label: "sellerLabel",
  seller_lat: "sellerLat",
  seller_lng: "sellerLng",
  buyer_label: "buyerLabel",
  buyer_lat: "buyerLat",
  buyer_lng: "buyerLng",
  buyer_phone: "buyerPhone",
  price_fee: "priceFee",
  status: "status",
  pickup_code: "pickupCode",
  delivery_code: "deliveryCode",
  tx_ref: "txRef",
  created_at: "createdAt",
  accepted_at: "acceptedAt",
  picked_at: "pickedAt",
  delivered_at: "deliveredAt",
};

function mapDelivery(id: string, d: any): CourseDelivery {
  const out: any = { id };
  for (const [k, f] of Object.entries(DELIVERY_FIELDS)) out[k] = d?.[f] ?? null;
  out.title = d?.title;
  out.package = d?.package ?? undefined;
  out.seller_name = d?.sellerName ?? undefined;
  out.courier_name = d?.courierName ?? undefined;
  out.courier_photo = d?.courierSelfie ?? null;
  out.courier_transport = d?.courierTransport ?? null;
  out.courier_locality = d?.courierLocality ?? null;
  out.courier_verified = d?.courierVerified ? 1 : 0;
  out.price_fee = Number(out.price_fee || 0);
  return out;
}

function deliveryCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const COMMISSION_RATE = 0.1;
const localDay = () => new Date().toLocaleDateString("en-CA");

async function duesDocs(uid: string): Promise<any[]> {
  const snap = await getDocs(query(collection(dbc(), "courier_dues"), where("courierId", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

async function buildDues(uid: string): Promise<CourierDues> {
  const u = await userDoc(uid);
  const docs = await duesDocs(uid);
  const byDay = new Map<string, CourierDueDay>();
  for (const d of docs) {
    const day = byDay.get(d.dueDate) || { due_date: d.dueDate, amount: 0, paid: 1, unpaid: 0 };
    day.amount += d.amount || 0;
    if (!d.paid) {
      day.paid = 0;
      day.unpaid += d.amount || 0;
    }
    byDay.set(d.dueDate, day);
  }
  const days = [...byDay.values()].sort((a, b) => (a.due_date < b.due_date ? 1 : -1));
  const today = localDay();
  const dueToday = days.find((d) => d.due_date === today && d.paid === 0)?.unpaid || 0;
  const totalUnpaid = days.reduce((s, d) => s + d.unpaid, 0);
  const pend = await getDocs(
    query(collection(dbc(), "payments"), where("courierId", "==", uid), where("status", "==", "pending"), limit(1))
  );
  const p = pend.docs[0]?.data();
  return {
    blocked: !!u?.blocked,
    blockedReason: u?.blocked_reason ?? null,
    dueToday,
    totalUnpaid,
    days,
    pendingPayment: p
      ? { id: pend.docs[0].id, amount: p.amount || 0, createdAt: p.createdAt?.toDate?.()?.toISOString?.() ?? null, hasReceipt: !!p.receipt }
      : null,
  };
}

export const firestoreBackend: DataBackend = {
  isDemo: false,

  async getCrops() {
    await ensureSeeded();
    const snap = await getDocs(query(collection(dbc(), "crops"), orderBy("name")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as Crop);
  },

async register(input: RegisterInput) {
    const { uid } = await fbSignup(input);
    const ussd = `SK-${uid.slice(0, 6).toUpperCase()}`;
    const [selfie, idFront, idBack] = await Promise.all([
      uploadImg(input.selfie, "selfie"),
      uploadImg(input.id_front, "id-front"),
      uploadImg(input.id_back, "id-back"),
    ]);
    await setDoc(doc(dbc(), "users", uid), {
      fullName: input.fullName,
      phone: input.phone,
      role: input.role,
      region: input.region || "Ouagadougou",
      village: input.village || null,
      locality: input.locality || null,
      transport: input.transport || null,
      selfie,
      idFront,
      idBack,
      docStatus: input.role === "courier" ? "pending" : "pending",
      ussdCode: ussd,
      verified: 0,
      createdAt: serverTimestamp(),
    });
    return (await userDoc(uid))!;
  },

  async googleLogin() {
    const cred = await signInWithPopup(authc(), new GoogleAuthProvider());
    const fb = cred.user;
    const profile = await userDoc(fb.uid);
    return {
      user: profile,
      draftName: fb.displayName || "",
      draftPhone: fb.phoneNumber || "",
      draftPhoto: fb.photoURL || null,
    };
  },

  async completeGoogleProfile(input: GoogleProfileInput) {
    const fb = authc().currentUser;
    if (!fb) throw new Error("Session Google expirée — reconnecte-toi");
    const ussd = `SK-${fb.uid.slice(0, 6).toUpperCase()}`;
    const [selfie, idFront, idBack] = await Promise.all([
      uploadImg(input.selfie, "selfie"),
      uploadImg(input.id_front, "id-front"),
      uploadImg(input.id_back, "id-back"),
    ]);
    await setDoc(doc(dbc(), "users", fb.uid), {
      fullName: input.name,
      phone: fb.phoneNumber || "",
      role: input.role,
      region: input.region || "Ouagadougou",
      village: input.village || null,
      locality: input.locality || null,
      transport: input.transport || null,
      selfie,
      idFront,
      idBack,
      docStatus: "pending",
      ussdCode: ussd,
      verified: 1,
      createdAt: serverTimestamp(),
    });
    return (await userDoc(fb.uid))!;
  },

  async updateCourierDossier(input: import("../types").CourierDossier) {
    const fb = authc().currentUser;
    if (!fb) throw new Error("Session expirée — reconnecte-toi");
    const patch: Record<string, unknown> = { docUpdatedAt: new Date().toISOString() };
    if (input.locality !== undefined && input.locality !== "") patch.locality = input.locality;
    if (input.transport !== undefined && input.transport !== "") patch.transport = input.transport;
    if (input.selfie) patch.selfie = await uploadImg(input.selfie, "selfie");
    if (input.id_front) patch.idFront = await uploadImg(input.id_front, "id-front");
    if (input.id_back) patch.idBack = await uploadImg(input.id_back, "id-back");
    const changed = Boolean(input.selfie || input.id_front || input.id_back);
    if (changed) patch.docStatus = "pending";
    await updateDoc(doc(dbc(), "users", fb.uid), patch);
    return (await userDoc(fb.uid))!;
  },

  async login(identifier: string, password: string) {
    const fbUser = await fbLogin(identifier, password);
    const profile = await userDoc(fbUser.uid);
    current = profile || mapFirebaseUser(fbUser);
    return current;
  },

  async logout() {
    await fbLogout();
    current = null;
  },

  async restoreSession() {
    const u = authc().currentUser as FBUser | null;
    if (!u) return null;
    const profile = await userDoc(u.uid);
    current = profile || mapFirebaseUser(u);
    return current;
  },

  async refreshUser(id: string) {
    current = await userDoc(id);
    return current;
  },

  subscribePrices(cropId: string, cb: (rows: PriceRow[]) => void): () => void {
    void ensureSeeded();
    const q = query(collection(dbc(), "prices"), where("cropId", "==", cropId));
    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot) => {
        const rows = snap.docs.map(mapPrice).sort((a, b) => a.price - b.price);
        if (!rows.length) cb(seedPricesFor(cropId));
        else cb(rows);
      },
      () => cb(seedPricesFor(cropId))
    );
    return unsub;
  },

async getTrend(cropId: string) {
    const snap = await getDocs(query(collection(dbc(), "prices"), where("cropId", "==", cropId)));
    const trend: TrendRow[] = snap.docs.map((d) => {
      const x = d.data();
      const today = x.avg;
      const weekAgo = Math.round(today * (0.92 + Math.random() * 0.1));
      return {
        market: x.marketName,
        today,
        weekAgo,
        changePct: Math.round(((today - weekAgo) / weekAgo) * 1000) / 10,
      };
    });
    return trend;
  },

  async reportPrice(cropId: string, marketId: string, price: number) {
    const db = dbc();
    const me = await refreshSelf();
    const uid = me?.id || authc().currentUser?.uid || "anon";
    const when = new Date(Date.now() - 48 * 3600 * 1000);
    const q = query(
      collection(db, "price_reports"),
      where("cropId", "==", cropId),
      where("marketId", "==", marketId),
      where("createdAt", ">=", when)
    );

    // Un même membre ne compte qu'une fois dans la fenêtre.
    const before = await getDocs(q);
    const existing = before.docs.map((d) => d.data());
    if (existing.some((r) => r.userId === uid)) {
      const prices = existing.map((r) => Number(r.price)).filter((p) => Number.isFinite(p));
      return {
        status: "pending" as const,
        confirmedBy: clusterOf(prices).length,
        reportsNeeded: REPORTS_TO_PUBLISH,
        price: prices[0] ?? price,
      };
    }

    await addDoc(collection(db, "price_reports"), {
      cropId,
      marketId,
      price: Math.round(price),
      userId: uid,
      applied: false,
      createdAt: serverTimestamp(),
    });

    const prices = [...existing.map((r) => Number(r.price)), Math.round(price)].filter((p) => Number.isFinite(p));
    const confirmed = clusterOf(prices);
    if (confirmed.length >= REPORTS_TO_PUBLISH) {
      const avg = Math.round(confirmed.reduce((a, b) => a + b, 0) / confirmed.length);
      const ref = doc(db, "prices", `${cropId}_${marketId}`);
      const market = SEED_MARKETS.find((m) => m.id === marketId);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const patch = {
          avg,
          min: Math.min(...confirmed),
          max: Math.max(...confirmed),
          reports: confirmed.length,
          source: "community",
          updatedAt: serverTimestamp(),
        };
        if (snap.exists()) {
          tx.update(ref, patch);
        } else {
          tx.set(ref, {
            cropId,
            marketId,
            marketName: market?.name || marketId,
            distance: 0,
            lat: market?.lat ?? null,
            lng: market?.lng ?? null,
            ...patch,
          });
        }
      });
      return { status: "published" as const, confirmedBy: confirmed.length, reportsNeeded: REPORTS_TO_PUBLISH, price: avg };
    }

    return { status: "pending" as const, confirmedBy: confirmed.length, reportsNeeded: REPORTS_TO_PUBLISH, price };
  },

  async createOffer(input: NewOffer) {
    const me = current || (await refreshSelf());
const cropsSnap = await getDocs(query(collection(dbc(), "crops")));
    const crop = cropsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).find((c: any) => c.id === input.cropId) as any;
    const image = await uploadImg(input.image, "offer");
    const ref = await addDoc(collection(dbc(), "offers"), {
      cropId: input.cropId,
      cropName: crop?.name || input.cropId,
      emoji: crop?.emoji || "",
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      status: "open",
      sellerId: me?.id,
      sellerName: me?.full_name,
      village: me?.village || "",
      region: me?.region || "",
lat: input.lat ?? null,
      lng: input.lng ?? null,
      image,
      createdAt: serverTimestamp(),
    });
    return {
      id: ref.id,
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
      image: input.image,
    };
  },

  async listMarketOffers() {
    const q = query(collection(dbc(), "offers"), where("status", "==", "open"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapOffer(d.id, d.data()));
  },

  async listMyOffers() {
    const me = await refreshSelf();
    if (!me) return [];
    const q = query(collection(dbc(), "offers"), where("sellerId", "==", me.id), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapOffer(d.id, d.data()));
  },

  async markOfferStatus(id: string, status: "open" | "sold" | "cancelled") {
    await updateDoc(doc(dbc(), "offers", id), { status });
  },

  async listThreads() {
    const me = await refreshSelf();
    if (!me) return [];
    const [sent, recv] = await Promise.all([
      getDocs(query(collection(dbc(), "messages"), where("senderId", "==", me.id), orderBy("createdAt", "desc"), limit(40))),
      getDocs(query(collection(dbc(), "messages"), where("recipientId", "==", me.id), orderBy("createdAt", "desc"), limit(40))),
    ]);
    const byOffer = new Map<string, any>();
    for (const snap of [sent, recv]) {
      for (const d of snap.docs) {
        const x = d.data();
        const prev = byOffer.get(x.offerId);
        const ts = x.createdAt?.toDate ? x.createdAt.toDate().getTime() : 0;
        if (!prev || ts > (prev._ts || 0)) {
          byOffer.set(x.offerId, { ...x, offerId: x.offerId, _ts: ts });
        }
      }
    }
    return [...byOffer.values()]
      .map((x: any) => ({
        offer_id: x.offerId,
        crop_name: x.cropName,
        emoji: x.emoji,
        quantity: x.quantity,
        unit_price: x.unitPrice,
        other_name: x.senderId === me.id ? x.recipientName : x.senderName,
        other_role: x.senderId === me.id ? x.recipientRole : x.senderRole,
        body: x.body,
        created_at: x.createdAt?.toDate ? x.createdAt.toDate().toISOString() : "",
      }))
      .sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
  },

  async getMessages(offerId: string) {
    const q = query(collection(dbc(), "messages"), where("offerId", "==", offerId), orderBy("createdAt", "asc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
body: x.body,
        sender_id: x.senderId,
        sender_name: x.senderName,
        created_at: x.createdAt?.toDate ? x.createdAt.toDate().toISOString() : "",
        kind: x.kind as "text" | "voice" | undefined,
        audio_url: (x.audioUrl as string | null | undefined) ?? null,
        duration_ms: x.durationMs ? Number(x.durationMs) : null,
      };
    });
  },

async sendMessage(offerId: string, body: string, voice?: { audio: string; duration: number }) {
    const me = await refreshSelf();
    if (!me) return;
    const offSnap = await getDoc(doc(dbc(), "offers", offerId));
    const off = offSnap.data();
    let recipientId = off?.sellerId ?? "";
    let recipientName = off?.sellerName ?? "";
    let recipientRole = "producer";

    if (off?.sellerId === me.id) {
      const last = await getDocs(query(collection(dbc(), "messages"), where("offerId", "==", offerId), orderBy("createdAt", "desc"), limit(1)));
      const l = last.docs[0]?.data();
      if (l && l.senderId !== me.id) {
        recipientId = l.senderId;
        recipientName = l.senderName;
        recipientRole = l.senderRole || "buyer";
      }
    }

    await addDoc(collection(dbc(), "messages"), {
      offerId,
      senderId: me.id,
      senderName: me.full_name,
      senderRole: me.role,
      recipientId,
      recipientName,
      recipientRole,
body,
      cropName: off?.cropName || "",
      emoji: off?.emoji || "",
      quantity: off?.quantity || 0,
      unitPrice: off?.unitPrice || 0,
      kind: voice ? "voice" : "text",
      audioUrl: voice ? voice.audio : null,
      durationMs: voice ? voice.duration : null,
      createdAt: serverTimestamp(),
    });
  },

  async deleteMessage(offerId: string, messageId: string) {
    await deleteDoc(doc(dbc(), "messages", messageId));
  },

  // Accusés de lecture : non géré côté Firebase (déploiement serveur uniquement).
  async markMessagesRead(_offerId: string) {
    return;
  },

  async listAlerts() {
    const me = await refreshSelf();
    if (!me) return [];
    const snap = await getDocs(query(collection(dbc(), "alerts"), where("userId", "==", me.id)));
    return snap.docs.map((d) => {
      const x = d.data();
      return fromFirestore<Alert>(d.id, x, {
        crop_id: "cropId",
        crop_name: "cropName",
        emoji: "emoji",
        target_price: "targetPrice",
      }) as Alert;
    });
  },

  async createAlert(cropId: string, targetPrice: number) {
    const me = await refreshSelf();
    const cropsSnap = await getDocs(query(collection(dbc(), "crops")));
    const crop = cropsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).find((c: any) => c.id === cropId) as any;
    const ref = await addDoc(collection(dbc(), "alerts"), {
      userId: me?.id,
      cropId,
      cropName: crop?.name || cropId,
      emoji: crop?.emoji || "",
      targetPrice,
      active: true,
      createdAt: serverTimestamp(),
    });
    return {
      id: ref.id,
      crop_id: cropId,
      crop_name: crop?.name || cropId,
      emoji: crop?.emoji,
      target_price: targetPrice,
    };
  },

  async deleteAlert(id: string) {
    await deleteDoc(doc(dbc(), "alerts", id));
  },

async startPayment(input: StartPaymentInput) {
    const me = await refreshSelf();
    const total = input.amount + input.fee;
    let sellerId = "";
    if (input.qtyKg) {
      await runTransaction(dbc(), async (tr) => {
        const offRef = doc(dbc(), "offers", input.offerId);
        const snap = await tr.get(offRef);
        if (!snap.exists()) return;
        const next = (snap.data()?.quantity || 0) - (input.qtyKg || 0);
        sellerId = snap.data()?.sellerId || "";
        tr.update(offRef, { quantity: Math.max(0, next), status: next <= 0 ? "sold" : (snap.data()?.status ?? "open") });
        tr.set(doc(collection(dbc(), "transactions")), {
          offerId: input.offerId,
          provider: input.providerId,
          providerName: input.providerName,
          amount: input.amount,
          fee: input.fee,
          total,
          buyerId: me?.id,
          buyerName: me?.full_name,
          buyerPhone: input.buyerPhone,
          sellerId,
          status: "completed",
          orderStatus: "escrow",
          ref: input.ref || makeTicketRef(input.providerId),
          qtyKg: input.qtyKg || null,
          delivery: input.delivery || null,
          createdAt: serverTimestamp(),
        });
      });
    }
    return {
      id: nanoid(),
      offer_id: input.offerId,
      provider: input.providerId,
      provider_name: input.providerName,
      amount: input.amount,
      fee: input.fee,
      total,
      buyer_id: me?.id || "",
      buyer_name: me?.full_name || "",
      buyer_phone: input.buyerPhone,
      seller_id: sellerId,
      status: "completed",
      ref: input.ref || makeTicketRef(input.providerId),
      qtyKg: input.qtyKg,
      delivery: input.delivery,
      order_status: "escrow",
      created_at: new Date().toISOString(),
    };
  },

  async checkout(input: CheckoutInput) {
    const me = await refreshSelf();
    const items = input.items;
    const total = input.amount + input.fee;
    const txRef = doc(collection(dbc(), "transactions"));
    const sellerIds: string[] = [];
    await runTransaction(dbc(), async (tr) => {
      for (const it of items) {
        const offRef = doc(dbc(), "offers", it.offerId);
        const snap = await tr.get(offRef);
        if (!snap.exists()) continue;
        const next = (snap.data()?.quantity || 0) - it.qtyKg;
        sellerIds.push(snap.data()?.sellerId || "");
        tr.update(offRef, {
          quantity: Math.max(0, next),
          status: next <= 0 ? "sold" : (snap.data()?.status ?? "open"),
        });
      }
      tr.set(txRef, {
        offerId: items[0]?.offerId || "",
        items: items.map((i) => ({
          offerId: i.offerId,
          cropName: i.cropName,
          emoji: i.emoji || null,
          qtyKg: i.qtyKg,
          unitPrice: i.unitPrice,
          amount: i.amount,
        })),
        provider: input.providerId,
        providerName: input.providerName,
        amount: input.amount,
        fee: input.fee,
        total,
        buyerId: me?.id,
        buyerName: me?.full_name,
        buyerPhone: input.buyerPhone,
        sellerId: sellerIds[0] || "",
        status: "completed",
        orderStatus: "escrow",
        ref: input.ref || makeTicketRef(input.providerId),
        delivery: input.delivery || null,
        createdAt: serverTimestamp(),
      });
    });
    return {
      id: txRef.id,
      offer_id: items[0]?.offerId || "",
      items,
      provider: input.providerId,
      provider_name: input.providerName,
      amount: input.amount,
      fee: input.fee,
      total,
      buyer_id: me?.id || "",
      buyer_name: me?.full_name || "",
      buyer_phone: input.buyerPhone,
      seller_id: sellerIds[0] || "",
      status: "completed",
      ref: input.ref || makeTicketRef(input.providerId),
      delivery: input.delivery,
      order_status: "escrow",
      created_at: new Date().toISOString(),
    };
  },

  async listTransactions() {
    const me = await refreshSelf();
    if (!me) return [];
    const snap = await getDocs(query(collection(dbc(), "transactions"), where("buyerId", "==", me.id), orderBy("createdAt", "desc")));
    return snap.docs.map((d) => {
      const x = d.data();
      return {
id: d.id,
        offer_id: x.offerId,
        provider: x.provider,
        provider_name: x.providerName,
        amount: x.amount,
        fee: x.fee,
        total: x.total,
        buyer_id: x.buyerId || "",
        buyer_name: x.buyerName || "",
        buyer_phone: x.buyerPhone || "",
        status: x.status,
        ref: x.ref,
        qtyKg: x.qtyKg,
        items: x.items,
        delivery: x.delivery,
        order_status: x.orderStatus || (x.disputed ? "disputed" : undefined),
        created_at: x.createdAt?.toDate ? x.createdAt.toDate().toISOString() : "",
      };
    });
  },

  async confirmDelivery(txId: string) {
    const t = await getDoc(doc(dbc(), "transactions", txId));
    if (!t.exists()) return;
    await updateDoc(doc(dbc(), "transactions", txId), {
      orderStatus: "delivered",
      disputed: false,
      confirmedAt: serverTimestamp(),
    });
  },

  async openDispute(txId: string, reason: string) {
    const t = await getDoc(doc(dbc(), "transactions", txId));
    if (!t.exists()) return;
    await updateDoc(doc(dbc(), "transactions", txId), {
      disputed: true,
      disputeReason: reason,
    });
  },

  async listSellerOrders(): Promise<SellerOrder[]> {
    return [];
  },

  async listMyPurchases(): Promise<BuyerOrder[]> {
    return [];
  },

  async listNearbyCouriers(lat?: number | null, lng?: number | null): Promise<NearbyCourier[]> {
    return [];
  },

  async assignOrderToCourier(input: AssignOrderInput): Promise<CourseDelivery> {
    throw new Error("Disponible en mode Koodo Cloud");
  },

  async listSellerEscrow(): Promise<import("./types").SellerEscrow> {
    const me = await refreshSelf();
    if (!me) return { escrow: { amount: 0, count: 0 }, delivered: { amount: 0, count: 0 }, disputed: { amount: 0, count: 0 } };
    const snap = await getDocs(query(collection(dbc(), "transactions"), where("sellerId", "==", me.id)));
    const out = { escrow: { amount: 0, count: 0 }, delivered: { amount: 0, count: 0 }, disputed: { amount: 0, count: 0 } };
    for (const d of snap.docs) {
      const x = d.data();
      if (x.disputed) out.disputed.amount += x.total || 0;
      else if ((x.orderStatus || "escrow") === "delivered") out.delivered.amount += x.total || 0;
      else out.escrow.amount += x.total || 0;
    }
    out.escrow.count = snap.docs.filter((d) => !d.data().disputed && (d.data().orderStatus || "escrow") !== "delivered").length;
    out.delivered.count = snap.docs.filter((d) => !d.data().disputed && d.data().orderStatus === "delivered").length;
    out.disputed.count = snap.docs.filter((d) => d.data().disputed).length;
    return out;
  },

  async listOpenDeliveries(lat?: number | null, lng?: number | null) {
    const snap = await getDocs(query(collection(dbc(), "deliveries"), where("status", "==", "open"), orderBy("createdAt", "desc")));
    return snap.docs.map((d) => ({ ...mapDelivery(d.id, d.data()), distanceKm: null }));
  },

  async createDelivery(input: CreateDeliveryInput) {
    const me = await refreshSelf();
    const ref = await addDoc(collection(dbc(), "deliveries"), {
      txRef: input.tx_ref || null,
      title: input.title,
      package: input.package || null,
      sellerId: me?.id,
      sellerName: me?.full_name,
      sellerLabel: input.seller_label || me?.village || "",
      sellerLat: input.seller_lat ?? null,
      sellerLng: input.seller_lng ?? null,
      buyerLabel: input.buyer_label,
      buyerLat: input.buyer_lat ?? null,
      buyerLng: input.buyer_lng ?? null,
      buyerPhone: input.buyer_phone ? input.buyer_phone.replace(/[\s\-().]/g, "") : null,
      priceFee: input.price_fee,
      status: "open",
      pickupCode: deliveryCode(),
      deliveryCode: deliveryCode(),
      createdAt: serverTimestamp(),
    });
    const snap = await getDoc(ref);
    return mapDelivery(ref.id, snap.data());
  },

  async listMyDeliveries() {
    const me = await refreshSelf();
    if (!me) return [];
    const [created, taken] = await Promise.all([
      getDocs(query(collection(dbc(), "deliveries"), where("sellerId", "==", me.id), orderBy("createdAt", "desc"))),
      getDocs(query(collection(dbc(), "deliveries"), where("courierId", "==", me.id), orderBy("createdAt", "desc"))),
    ]);
    const seen = new Set<string>();
    const out: CourseDelivery[] = [];
    for (const d of [...created.docs, ...taken.docs]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ ...mapDelivery(d.id, d.data()), distanceKm: null });
    }
    out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return out;
  },

  async acceptDelivery(id: string) {
    const me = await refreshSelf();
    // Parité serveur : le dossier livreur doit être complet avant d'accepter une course.
    if (
      me?.role === "courier" &&
      !(me.locality && me.transport && me.selfie && me.id_front && me.id_back)
    ) {
      throw new Error("Dossier incomplet — complète localité, moyen de déplacement, photo et pièce d'identité (recto + verso) avant d'accepter.");
    }
    const offSnap = await getDoc(doc(dbc(), "deliveries", id));
    if (!offSnap.exists() || offSnap.data().status !== "open") throw new Error("Cette course n'est plus disponible");
    await updateDoc(doc(dbc(), "deliveries", id), {
      courierId: me?.id,
      courierName: me?.full_name,
      status: "accepted",
      acceptedAt: serverTimestamp(),
    });
    await addDeliveryEvent(id, {
      kind: "delivery_accepted",
      title: "Livreur trouvé",
      body: `${me?.full_name} a accepté « ${(offSnap.data().title || "").slice(0, 40)} ». C'est lui qui va te livrer.`,
      actorName: me?.full_name || "",
      actorPhoto: me?.selfie || "",
      actorUid: me?.id || "",
    });
    const snap = await getDoc(doc(dbc(), "deliveries", id));
    return mapDelivery(id, snap.data());
  },

  async cancelDelivery(id: string) {
    const me = await refreshSelf();
    const offSnap = await getDoc(doc(dbc(), "deliveries", id));
    if (offSnap.exists() && offSnap.data().sellerId === me?.id) {
      await updateDoc(doc(dbc(), "deliveries", id), { status: "cancelled" });
    }
  },

  async pickupDelivery(id: string, pickupCode: string) {
    const me = await refreshSelf();
    const snap = await getDoc(doc(dbc(), "deliveries", id));
    if (!snap.exists() || snap.data().pickupCode !== pickupCode) throw new Error("Code de récupération invalide");
    await updateDoc(doc(dbc(), "deliveries", id), { status: "picked_up", pickedAt: serverTimestamp() });
    await addDeliveryEvent(id, {
      kind: "delivery_picked",
      title: "Colis récupéré, en route",
      body: `${me?.full_name} a récupéré le colis et se dirige vers toi.`,
      actorName: me?.full_name || "",
      actorPhoto: me?.selfie || "",
      actorUid: me?.id || "",
    });
    const fresh = await getDoc(doc(dbc(), "deliveries", id));
    return mapDelivery(id, fresh.data());
  },

  async completeDelivery(id: string, deliveryCodeInput: string) {
    const me = await refreshSelf();
    const snap = await getDoc(doc(dbc(), "deliveries", id));
    const d = snap.data();
    if (!snap.exists() || d?.deliveryCode !== deliveryCodeInput) throw new Error("Code de livraison invalide");
    const commission = Math.round(Number(d?.priceFee || 0) * COMMISSION_RATE);
    await updateDoc(doc(dbc(), "deliveries", id), { status: "done", deliveredAt: serverTimestamp() });
    await addDeliveryEvent(id, {
      kind: "delivery_done",
      title: "Course livrée",
      body: `${me?.full_name} a remis le colis à l'acheteur. Merci pour ta course.`,
      actorName: me?.full_name || "",
      actorPhoto: me?.selfie || "",
      actorUid: me?.id || "",
    });
    await setDoc(doc(dbc(), "courier_dues", `${me?.id}_${localDay()}_${id}`), {
      courierId: me?.id,
      dueDate: localDay(),
      amount: commission,
      paid: false,
      createdAt: serverTimestamp(),
    });
    const fresh = await getDoc(doc(dbc(), "deliveries", id));
    const dues = await buildDues(me?.id || "");
    return { delivery: mapDelivery(id, fresh.data()), commission, dueToday: dues.dueToday };
  },

  async deliveryForMe() {
    const me = await refreshSelf();
    if (!me) return null;
    const snap = await getDocs(
      query(collection(dbc(), "deliveries"), where("buyerPhone", "==", me.phone), where("status", "in", ["accepted", "picked_up"]))
    );
    const d = snap.docs[0];
    return d ? mapDelivery(d.id, d.data()) : null;
  },

  async courierDues() {
    const me = await refreshSelf();
    if (!me) return { blocked: false, dueToday: 0, totalUnpaid: 0, days: [] };
    return buildDues(me.id);
  },

  async settleDues(receiptImage?: string) {
    const me = await refreshSelf();
    if (!me) return { blocked: false, dueToday: 0, totalUnpaid: 0, days: [] };
    if (!receiptImage) throw new Error("Capture d'écran obligatoire — joins la preuve de ton règlement");
    const docs = await duesDocs(me.id);
    const totalUnpaid = docs.reduce((s, d) => (d.paid ? s : s + (d.amount || 0)), 0);
    const pid = nanoid();
    const receipt = await uploadImg(receiptImage, "receipt");
    // Capture envoyée : le règlement reste en attente de confirmation admin.
    await setDoc(doc(dbc(), "payments", pid), {
      courierId: me.id,
      amount: totalUnpaid,
      receipt,
      status: "pending",
      createdAt: serverTimestamp(),
      confirmedAt: null,
    });
    await updateDoc(doc(dbc(), "users", me.id), { blocked: true, blockedReason: "Paiement envoyé — en attente de vérification par l'admin" });
    return buildDues(me.id);
  },

  async adminListCouriers() {
    const snap = await getDocs(query(collection(dbc(), "users"), where("role", "==", "courier")));
    const out: AdminCourier[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      out.push({
        id: d.id,
        full_name: data.fullName || "",
        phone: data.phone || "",
        locality: data.locality ?? null,
        transport: data.transport ?? null,
        selfie: data.selfie ?? null,
        doc_status: data.docStatus ?? data.doc_status ?? "pending",
        blocked: data.blocked ?? false,
        blocked_reason: data.blockedReason ?? null,
        totalUnpaid: 0,
      });
    }
    return out;
  },

  async adminVerifyCourier(id: string) {
    await updateDoc(doc(dbc(), "users", id), {
      docStatus: "verified",
      docUpdatedAt: serverTimestamp(),
      blocked: false,
      blockedReason: null,
    });
  },

  async adminListPayments() {
    const snap = await getDocs(query(collection(dbc(), "payments"), where("status", "==", "pending"), orderBy("createdAt", "desc")));
    const out: AdminPayment[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      const u = data.courierId ? await userDoc(data.courierId) : null;
      out.push({
        id: d.id,
        amount: data.amount || 0,
        receipt: data.receipt ?? null,
        status: data.status,
        created_at: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
        full_name: u?.full_name ?? "",
        phone: u?.phone ?? "",
      });
    }
    return out;
  },

  async adminConfirmPayment(id: string) {
    const p = await getDoc(doc(dbc(), "payments", id));
    if (!p.exists()) throw new Error("Paiement introuvable");
    const data = p.data();
    await updateDoc(p.ref, { status: "confirmed", confirmedAt: serverTimestamp() });
    const pays = await getDocs(query(collection(dbc(), "courier_dues"), where("courierId", "==", data.courierId), where("paid", "==", false)));
    await Promise.all(
      pays.docs.map((d) => updateDoc(d.ref, { paid: true, paidAt: serverTimestamp() }))
    );
    await updateDoc(doc(dbc(), "users", data.courierId), { blocked: false, blockedReason: null });
  },

  async listNotifications() {
    const me = await refreshSelf();
    if (!me) return [];
    const courseIds = await myCourseIds(me);
    if (courseIds.length === 0) return [];
    const readSet = new Set<string>();
    await Promise.all(
      courseIds.map(async (cid) => {
        const s = await getDoc(doc(dbc(), "notifications_seen", me.id, "courses", cid));
        if (s.exists()) readSet.add(cid);
      })
    );
    const events: AppNotification[] = [];
    await Promise.all(
      courseIds.map(async (cid) => {
        const es = await getDocs(
          query(collection(dbc(), "deliveries", cid, "events"), orderBy("createdAt", "desc"), limit(10))
        );
        for (const e of es.docs) {
          const ev = e.data();
          events.push({
            id: e.id,
            kind: ev.kind || "delivery",
            title: ev.title || "Mise à jour de ta course",
            body: ev.body || "",
            actor_name: ev.actorName || null,
            actor_photo: ev.actorPhoto || null,
            delivery_id: cid,
            seen: readSet.has(cid),
            created_at: ev.createdAt?.toDate?.().toISOString() || "",
          });
        }
      })
    );
    events.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const out: AppNotification[] = [];
    const dedupe = new Set<string>();
    for (const e of events) {
      const key = `${e.delivery_id}:${e.kind}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      out.push(e);
    }
    return out;
  },

  async markNotificationsRead() {
    const me = await refreshSelf();
    if (!me) return;
    const courseIds = await myCourseIds(me);
    await Promise.all(
      courseIds.map((cid) =>
        setDoc(doc(dbc(), "notifications_seen", me.id, "courses", cid), { at: serverTimestamp() }).catch(() => {})
      )
    );
  },

  async supportListThreads(): Promise<import("./types").SupportThread[]> {
    const me = await refreshSelf();
    if (!me) return [];
    const snap = await getDocs(
      query(collection(dbc(), "support_threads"), where("userId", "==", me.id), orderBy("lastMessageAt", "desc"))
    );
    return snap.docs.map((d) => mapSupportThread(d.id, d.data()));
  },

  async supportCreateThread(subject: string, body: string): Promise<import("./types").SupportThread> {
    const me = await refreshSelf();
    if (!me) throw new Error("Identifiant-toi");
    const threadRef = doc(collection(dbc(), "support_threads"));
    await setDoc(threadRef, {
      userId: me.id,
      subject,
      status: "open",
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    await addDoc(collection(dbc(), "support_messages"), {
      threadId: threadRef.id,
      senderRole: "user",
      senderId: me.id,
      body,
      createdAt: serverTimestamp(),
    });
    return {
      id: threadRef.id,
      subject,
      status: "open",
      last_message: body,
      last_sender: "user",
      last_at: new Date().toISOString(),
      message_count: 1,
      created_at: new Date().toISOString(),
    };
  },

  async supportListMessages(threadId: string): Promise<import("./types").SupportMsg[]> {
    const me = await refreshSelf();
    if (!me) return [];
    const t = await getDoc(doc(dbc(), "support_threads", threadId));
    if (!t.exists() || t.data()?.userId !== me.id) return [];
    return supportMessagesOf(threadId);
  },

  async supportSendMessage(threadId: string, body: string): Promise<import("./types").SupportMsg[]> {
    const me = await refreshSelf();
    if (!me) return [];
    const t = await getDoc(doc(dbc(), "support_threads", threadId));
    if (!t.exists() || t.data()?.userId !== me.id) return [];
    await addDoc(collection(dbc(), "support_messages"), {
      threadId,
      senderRole: "user",
      senderId: me.id,
      body,
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(dbc(), "support_threads", threadId), {
      status: "open",
      lastMessageAt: serverTimestamp(),
    });
    return supportMessagesOf(threadId);
  },

  async adminSupportList(): Promise<import("./types").AdminSupportThread[]> {
    const snap = await getDocs(query(collection(dbc(), "support_threads"), orderBy("lastMessageAt", "desc")));
    const out: import("./types").AdminSupportThread[] = [];
    for (const d of snap.docs) {
      const x = d.data();
      const u = x.userId ? await userDoc(x.userId) : null;
      out.push({
        ...mapSupportThread(d.id, x),
        full_name: u?.full_name || "",
        phone: u?.phone || "",
      });
    }
    return out;
  },

  async adminSupportMessages(threadId: string): Promise<import("./types").SupportMsg[]> {
    return supportMessagesOf(threadId);
  },

  async adminSupportReply(threadId: string, body: string): Promise<void> {
    const me = await refreshSelf();
    if (!me) return;
    const t = await getDoc(doc(dbc(), "support_threads", threadId));
    if (!t.exists()) return;
    await addDoc(collection(dbc(), "support_messages"), {
      threadId,
      senderRole: "admin",
      senderId: me.id,
      body,
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(dbc(), "support_threads", threadId), {
      status: "answered",
      lastMessageAt: serverTimestamp(),
    });
  },

  // --- Conformité / modération (simulation locale sans serveur) ---
  async deleteAccount(): Promise<void> {
    try {
      await signOut(authc());
    } catch {
      // Déjà déconnecté.
    }
  },

  async reportOffer(): Promise<void> {
    // Signalement accepté (mode locale) — rien à persister ici.
  },

  async blockUser(): Promise<void> {
    // Accepté — le marché Firestore n'implémente pas les blocages.
  },

  async adminListReports(): Promise<import("./types").AdminReport[]> {
    return [];
  },

  async adminHandleReport(): Promise<void> {
    // Sans signalements locaux, rien à traiter.
  },
};

function mapSupportThread(id: string, x: any): import("./types").SupportThread {
  return {
    id,
    subject: x.subject || "",
    status: (x.status as any) || "open",
    last_message: x.lastMessage ?? null,
    last_sender: (x.lastSender as any) ?? null,
    last_at: toIso(x.lastMessageAt),
    message_count: Number(x.messageCount ?? 0),
    created_at: toIso(x.createdAt),
  };
}

async function supportMessagesOf(threadId: string): Promise<import("./types").SupportMsg[]> {
  const snap = await getDocs(
    query(collection(dbc(), "support_messages"), where("threadId", "==", threadId), orderBy("createdAt", "asc"))
  );
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      sender_role: (x.senderRole as any) || "user",
      sender_id: x.senderId || "",
      body: x.body || "",
      created_at: toIso(x.createdAt),
    };
  });
}

function toIso(v: any): string {
  return v?.toDate ? v.toDate().toISOString() : v ? String(v) : "";
}

async function refreshSelf(): Promise<User | null> {
  const u = authc().currentUser;
  if (!u) return current;
  current = (await userDoc(u.uid)) || mapFirebaseUser(u);
  return current;
}

// Courses auxquelles le compte participe (vendeur, livreur ou acheteur).
async function myCourseIds(me: User): Promise<string[]> {
  const [created, taken, bought] = await Promise.all([
    getDocs(query(collection(dbc(), "deliveries"), where("sellerId", "==", me.id), orderBy("createdAt", "desc"), limit(10))),
    getDocs(query(collection(dbc(), "deliveries"), where("courierId", "==", me.id), orderBy("createdAt", "desc"), limit(10))),
    getDocs(
      query(
        collection(dbc(), "deliveries"),
        where("buyerPhone", "==", me.phone),
        orderBy("createdAt", "desc"),
        limit(10)
      )
    ),
  ]);
  const seen = new Set<string>();
  for (const snap of [created, taken, bought]) for (const d of snap.docs) seen.add(d.id);
  return [...seen];
}

async function addDeliveryEvent(
  deliveryId: string,
  ev: { kind: string; title: string; body: string; actorName: string; actorPhoto: string; actorUid: string }
) {
  try {
    await addDoc(collection(dbc(), "deliveries", deliveryId, "events"), { ...ev, createdAt: serverTimestamp() });
  } catch {
    // Un événement de notification ne doit jamais bloquer l'action de livraison.
  }
}

export function fbOnUserChange(cb: (u: FBUser | null) => void) {
  return onAuthStateChanged(authc(), cb);
}
