export type Role = "producer" | "buyer" | "courier" | "admin";

export interface User {
  id: string;
  full_name: string;
  phone: string;
  email?: string | null;
  auth_provider?: string;
  role: Role;
  region?: string | null;
  village?: string | null;
  verified?: number;
  ussd_code?: string | null;
  blocked?: number;
  blocked_reason?: string | null;
  /** Dossier livreur : localité d'exercice, moyen de déplacement, photos. */
  locality?: string | null;
  transport?: string | null;
  selfie?: string | null;
  id_front?: string | null;
  id_back?: string | null;
  doc_status?: string;
  doc_updated_at?: string | null;
}

export type DeliveryStatus = "open" | "cancelled" | "accepted" | "picked_up" | "done";

/** Course de livraison entre un vendeur, un livreur et l'acheteur. */
export interface CourseDelivery {
  id: string;
  tx_ref?: string;
  title: string;
  package?: string;
  seller_id: string;
  seller_name?: string;
  courier_id?: string;
  courier_name?: string;
  /** Identité publique du livreur (photo de profil + élément de localisation),
   *  visible par le vendeur et l'acheteur — jamais les photos de la pièce. */
  courier_photo?: string;
  courier_transport?: string;
  courier_locality?: string;
  courier_verified?: number;
  seller_label?: string;
  seller_lat?: number;
  seller_lng?: number;
  buyer_label: string;
  buyer_lat?: number;
  buyer_lng?: number;
  buyer_phone?: string;
  price_fee: number;
  status: DeliveryStatus;
  /** Code remis par le vendeur au livreur (preuve de récupération du colis). */
  pickup_code?: string;
  /** Code remis par l'acheteur au livreur (preuve de livraison). */
  delivery_code?: string;
  distanceKm?: number | null;
  created_at?: string;
  accepted_at?: string;
  picked_at?: string;
  delivered_at?: string;
}

export interface CourierDueDay {
  due_date: string;
  amount: number;
  paid: number;
  unpaid: number;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** Identité publique de l'acteur (photo + nom) — jamais les photos de pièce. */
  actor_name?: string | null;
  actor_photo?: string | null;
  offer_id?: string | null;
  delivery_id?: string | null;
  seen: boolean;
  created_at: string;
}

export interface CourierDues {
  blocked: boolean;
  blockedReason?: string | null;
  dueToday: number;
  totalUnpaid: number;
  days: CourierDueDay[];
  /** Règlement envoyé avec capture d'écran, en attente de confirmation admin. */
  pendingPayment?: { id: string; amount: number; createdAt?: string | null; hasReceipt?: boolean } | null;
}

/** Ligne d'un livreur dans la console admin. */
export interface AdminCourier {
  id: string;
  full_name: string;
  phone: string;
  locality?: string | null;
  transport?: string | null;
  selfie?: string | null;
  doc_status?: string | null;
  doc_updated_at?: string | null;
  blocked?: boolean;
  blocked_reason?: string | null;
  totalUnpaid: number;
}

/** Règlement en attente dans la console admin. */
export interface AdminPayment {
  id: string;
  amount: number;
  receipt?: string | null;
  status?: string;
  created_at?: string;
  full_name?: string;
  phone?: string;
}

export interface CreateDeliveryInput {
  title: string;
  package?: string;
  buyer_label: string;
  buyer_lat?: number | null;
  buyer_lng?: number | null;
  buyer_phone?: string;
  price_fee: number;
  tx_ref?: string;
  seller_lat?: number | null;
  seller_lng?: number | null;
  seller_label?: string;
}

/** Dossier livreur (obligatoire pour accepter des courses). Les photos de la
 *  pièce d'identité sont stockées sur nos serveurs et NE peuvent PAS être
 *  supprimées par le livreur (uniquement remplacées). */
export interface CourierDossier {
  locality?: string;
  transport?: string;
  /** Photo récente du livreur (visible par vendeur/acheteur). */
  selfie?: string;
  /** Photo recto de la carte d'identité (privée, réservée à Koodo). */
  id_front?: string;
  /** Photo verso de la carte d'identité (privée, réservée à Koodo). */
  id_back?: string;
}

export interface NearbyCourier {
  id: string;
  name: string;
  phone: string;
  locality?: string | null;
  transport?: string | null;
  selfie?: string | null;
  /** Proche de la zone du vendeur (localité/village/région). */
  proche: boolean;
  score: number;
}

export interface SellerOrderItem {
  offerId: string;
  cropName: string;
  qtyKg: number;
  amount: number;
}

/** Commande reçue par un vendeur, groupée par panier (client_ref). */
export interface SellerOrder {
  txId: string;
  createdAt: string;
  status: "escrow" | "delivered";
  disputed: boolean;
  amount: number;
  qty: number;
  items: SellerOrderItem[];
  buyerName: string;
  buyerPhone: string;
  delivery: { label: string | null; lat: number | null; lng: number | null; note: string | null } | null;
  /** Course liée quand la commande a été confiée à un livreur. */
  deliveryMove: { id: string; status: string; courierName: string | null } | null;
}

export interface AssignOrderInput {
  txId: string;
  courierId: string;
  priceFee: number;
  sellerLat?: number | null;
  sellerLng?: number | null;
  sellerLabel?: string;
}

/** Achat d'un acheteur, groupé par panier (client_ref), avec suivi de course. */
export interface BuyerOrder {
  txId: string;
  createdAt: string;
  status: "escrow" | "delivered";
  disputed: boolean;
  amount: number;
  qty: number;
  items: SellerOrderItem[];
  sellerName: string;
  sellerPhone: string;
  provider: string;
  reference: string | null;
  delivery: { label: string | null; lat: number | null; lng: number | null; note: string | null } | null;
  /** Course liée quand l'achat a été confié à un livreur. deliveryCode = le
   *  code que l'acheteur doit donner (ou faire scanner) au livreur à la remise. */
  deliveryMove: { id: string; status: string; courierName: string | null; deliveryCode?: string | null } | null;
  /** Vrai si la course est terminée (ou qu'aucune course n'existe) et que les
   *  fonds sont toujours bloqués → l'acheteur peut les libérer au vendeur. */
  releaseable: boolean;
}

export const TRANSPORTS: { label: string; emoji: string }[] = [
  { label: "moto", emoji: "🏍️" },
  { label: "vélo", emoji: "🚲" },
  { label: "voiture", emoji: "🚗" },
  { label: "camionnette", emoji: "🚐" },
  { label: "à pied", emoji: "🚶" },
];

export interface Crop {
  id: string;
  name: string;
  unit: string;
  emoji?: string;
}

export interface PriceRow {
  market_id: string;
  market: string;
  price: number;
  min_price: number;
  max_price: number;
  distance: number;
  lat?: number;
  lng?: number;
  source?: string;
}

export interface TrendRow {
  market: string;
  today: number;
  weekAgo: number;
  changePct: number;
}

export interface Offer {
  id: string;
  crop_id: string;
  crop_name: string;
  emoji?: string;
  quantity: number;
  unit_price: number;
  status: "open" | "sold" | "cancelled" | "pending";
  created_at: string;
  seller_id?: string;
  seller?: string;
  village?: string;
  region?: string;
  lat?: number;
  lng?: number;
  image?: string;
}

export interface Alert {
  id: string;
  crop_id: string;
  target_price: number;
  crop_name: string;
  emoji?: string;
}
