import type { User, Role, Crop, PriceRow, TrendRow, Offer, Alert, CourseDelivery, CourierDues, CreateDeliveryInput, CourierDossier, AppNotification, AdminCourier, AdminPayment } from "../types";

export type Unsub = () => void;

/** Résultat de la publication d'un prix communautaire (radio anti-fraude). */
export interface PriceReportResult {
  /** "published" = le prix est publié (2 signalements concordants) ; "pending" = en attente. */
  status: "published" | "pending";
  /** Nombre de signalements concordants déjà enregistrés. */
  confirmedBy: number;
  /** Nombre de signalements concordants nécessaires. */
  reportsNeeded: number;
  /** Nouveau prix publié (si status === "published"). */
  price?: number;
}

export interface RegisterInput {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
  role: Role;
  region?: string;
  village?: string;
  /** Dossier livreur (obligatoire si role = courier). */
  locality?: string;
  transport?: string;
  selfie?: string;
  id_front?: string;
  id_back?: string;
}

export interface NewOffer {
  cropId: string;
  quantity: number;
  unitPrice: number;
  lat?: number | null;
  lng?: number | null;
  image?: string;
}

export interface Thread {
  offer_id: string;
  crop_name: string;
  emoji?: string;
  quantity: number;
  unit_price: number;
  other_name: string;
  other_role: string;
  body: string;
  created_at: string;
  /** Messages entrants non encore lus (badge de conversation). */
  unread?: number;
}

export interface Msg {
  id: string;
  body: string;
  sender_id: string;
  sender_name: string;
  created_at: string;
  /** 1 = lu par le destinataire (accusé de lecture). */
  seen?: number;
}

export interface DeliveryInfo {
  lat: number;
  lng: number;
  label: string;
  note?: string;
}

export interface TxItem {
  offerId: string;
  cropName: string;
  emoji?: string;
  qtyKg: number;
  unitPrice: number;
  amount: number;
}

export interface Tx {
  id: string;
  offer_id: string;
  provider: string;
  provider_name: string;
  amount: number;
  fee: number;
  total: number;
  buyer_id: string;
  buyer_name: string;
  buyer_phone: string;
  seller_id?: string;
  status: "pending" | "completed" | "failed";
  ref?: string;
  created_at: string;
  qtyKg?: number;
  items?: TxItem[];
  delivery?: DeliveryInfo;
  order_status?: "escrow" | "delivered" | "disputed";
}

export interface SellerEscrow {
  escrow: { amount: number; count: number };
  delivered: { amount: number; count: number };
  disputed: { amount: number; count: number };
}

export interface StartPaymentInput {
  offerId: string;
  amount: number;
  providerId: string;
  providerName: string;
  fee: number;
  buyerPhone: string;
  ref?: string;
  qtyKg?: number;
  delivery?: DeliveryInfo;
}

export interface CheckoutInput {
  items: TxItem[];
  amount: number;
  fee: number;
  providerId: string;
  providerName: string;
  buyerPhone: string;
  ref?: string;
  delivery?: DeliveryInfo;
}

export interface GoogleSignInResult {
  user: User | null;
  draftName: string;
  draftPhone: string;
  draftPhoto?: string | null;
  /** Jeton de création fourni par le mode démo (simulation Google). */
  draftToken?: string;
}

export interface GoogleProfileInput {
  name: string;
  phone?: string;
  role: Role;
  region?: string;
  village?: string;
  /** Jeton de création du compte Google (mode démo : simulation). */
  draftToken?: string;
  /** Dossier livreur (obligatoire si role = courier). */
  locality?: string;
  transport?: string;
  selfie?: string;
  id_front?: string;
  id_back?: string;
}

export interface DataBackend {
  isDemo: boolean;
  getCrops(): Promise<Crop[]>;
  register(input: RegisterInput): Promise<User>;
  login(identifier: string, password: string): Promise<User>;
  logout(): Promise<void>;
  restoreSession(): Promise<User | null>;
  refreshUser(id: string): Promise<User | null>;

  /** Connexion Google (disponible en mode Firebase). user = null si profil à créer. */
  googleLogin(): Promise<GoogleSignInResult>;
  /** Complète le profil après un compte Google sans profil. */
  completeGoogleProfile(input: GoogleProfileInput): Promise<User>;
  /** Le livreur modifie son dossier (localité, déplacement, photos). Les pièces
   *  ne peuvent pas être supprimées, seulement remplacées. Retourne l'user à jour. */
  updateCourierDossier(input: CourierDossier): Promise<User>;

  subscribePrices(cropId: string, cb: (rows: PriceRow[]) => void): Unsub;
  getTrend(cropId: string): Promise<TrendRow[]>;
  /** Signale le prix du jour observé sur une ville. Le prix n'est publié qu'après
   *  2 signalements concordants (radio communautaire anti-fraude). */
  reportPrice(cropId: string, marketId: string, price: number): Promise<PriceReportResult>;

  createOffer(input: NewOffer): Promise<Offer>;
  listMarketOffers(): Promise<Offer[]>;
  listMyOffers(): Promise<Offer[]>;
  markOfferStatus(id: string, status: "open" | "sold" | "cancelled"): Promise<void>;

  listThreads(): Promise<Thread[]>;
  getMessages(offerId: string): Promise<Msg[]>;
  sendMessage(offerId: string, body: string): Promise<void>;
  deleteMessage(offerId: string, messageId: string): Promise<void>;
  /** Marque la conversation comme lue (accusés + cloche). */
  markMessagesRead(offerId: string): Promise<void>;

  listAlerts(): Promise<Alert[]>;
  createAlert(cropId: string, targetPrice: number): Promise<Alert>;
  deleteAlert(id: string): Promise<void>;

  startPayment(input: StartPaymentInput): Promise<Tx>;
  listTransactions(): Promise<Tx[]>;
  /** Paiement de plusieurs produits (panier) en une seule transaction Mobile Money. */
  checkout(input: CheckoutInput): Promise<Tx>;
  /** L'acheteur confirme la réception → libère les fonds (escrow) au vendeur. */
  confirmDelivery(txId: string): Promise<void>;
  /** Ouvrir un litige (acheteur ou vendeur) pour bloquer la libération des fonds. */
  openDispute(txId: string, reason: string): Promise<void>;
  /** Vue vendeur : fonds en attente / libérés / litiges. */
  listSellerEscrow(): Promise<SellerEscrow>;

  // ============================================================
  // Livraisons communautaires (livreur)
  // ============================================================
  /** Liste les courses ouvertes proches (le livreur cherche du travail). */
  listOpenDeliveries(lat?: number | null, lng?: number | null): Promise<CourseDelivery[]>;
  /** Le vendeur crée une course (récupérer chez lui, livrer à l'acheteur). */
  createDelivery(input: CreateDeliveryInput): Promise<CourseDelivery>;
  /** Mes courses : créées (vendeur) ou attribuées (livreur). */
  listMyDeliveries(): Promise<CourseDelivery[]>;
  /** Le livreur accepte la course → reçoit le code du vendeur. */
  acceptDelivery(id: string): Promise<CourseDelivery>;
  /** Le vendeur annule la course (tant qu'elle est ouverte/acceptée). */
  cancelDelivery(id: string): Promise<void>;
  /** Preuve de récupération du colis avec le code du vendeur. */
  pickupDelivery(id: string, pickupCode: string): Promise<CourseDelivery>;
  /** Livraison remise avec le code de l'acheteur → commission 10 %. */
  completeDelivery(id: string, deliveryCode: string): Promise<{ delivery: CourseDelivery; commission: number; dueToday: number }>;
  /** L'acheteur dont la commande est en cours de livraison voit son code. */
  deliveryForMe(): Promise<CourseDelivery | null>;
  /** Dû du livreur : solde quotidien, blocage, jours à payer. */
  courierDues(): Promise<CourierDues>;
  /** Règle le dû Koodo. receiptImage (optionnelle) = capture d'écran du paiement :
   *  si fournie, le règlement reste en attente de confirmation admin, sinon il est
   *  immédiat (mode démo). */
  settleDues(receiptImage?: string): Promise<CourierDues>;

  /** Console admin : vérification des dossiers livreurs + confirmation des règlements. */
  adminListCouriers(): Promise<AdminCourier[]>;
  adminVerifyCourier(id: string): Promise<void>;
  adminListPayments(): Promise<AdminPayment[]>;
  adminConfirmPayment(id: string): Promise<void>;

  // ============================================================
  // Notifications in-app (vendeur & acheteur à l'acceptation d'un livreur)
  // ============================================================
  listNotifications(): Promise<AppNotification[]>;
  markNotificationsRead(): Promise<void>;

  // ============================================================
  // Aide / service technique (tous les comptes)
  // ============================================================
  /** Mes demandes d'aide. */
  supportListThreads(): Promise<SupportThread[]>;
  /** Ouvrir une demande d'aide. */
  supportCreateThread(subject: string, body: string): Promise<SupportThread>;
  /** Les messages d'une de mes demandes (dont les réponses du service). */
  supportListMessages(threadId: string): Promise<SupportMsg[]>;
  /** Envoyer un message dans ma demande. */
  supportSendMessage(threadId: string, body: string): Promise<SupportMsg[]>;

  /** Console admin : toutes les demandes d'aide. */
  adminSupportList(): Promise<AdminSupportThread[]>;
  /** Messages d'une demande (accès admin). */
  adminSupportMessages(threadId: string): Promise<SupportMsg[]>;
  /** Réponse du service technique. */
  adminSupportReply(threadId: string, body: string): Promise<void>;
}

export interface SupportThread {
  id: string;
  subject: string;
  status: "open" | "answered" | "closed";
  last_message: string | null;
  last_sender: "user" | "admin" | null;
  last_at: string;
  message_count: number;
  created_at: string;
}

export interface SupportMsg {
  id: string;
  sender_role: "user" | "admin";
  sender_id: string;
  body: string;
  created_at: string;
}

export interface AdminSupportThread extends SupportThread {
  full_name: string;
  phone: string;
}