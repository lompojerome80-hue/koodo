// ============================================================
// Paiements Mobile Money (Côte d'Ivoire).
//
// Deux modes, pilotés par l'environnement :
//   PAYMENTS_MODE=sandbox  (DÉFAUT) — simulation : aucune somme
//                       n'est débitée, une référence factice est
//                       renvoyée. Sans effet sur les comptes des
//                       opérateurs.
//   PAYMENTS_MODE=reel  — initiation d'un paiement CinetPay
//                       (agrégateur Orange Money / MTN MoMo /
//                       Wave / Moov CI). Exige :
//                         CINETPAY_TOKEN   (clé API CinetPay)
//                         CINETPAY_SITE_ID (id de site marchand)
//                         CINETPAY_SECRET  (pour vérifier les webhooks)
//                       Les clés restent côté serveur, jamais
//                       envoyées au client.
//
// IMPORTANT : la confirmation réelle d'un paiement se fait UNIQUEMENT
// via le webhook CinetPay (voir verifyWebhookSignature). Tant que la
// transaction n'est pas confirmée, l'achat ne doit pas être validé.
// ============================================================

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const realMode = () => process.env.PAYMENTS_MODE === "reel";

function cinetpayEnv() {
  return {
    token: process.env.CINETPAY_TOKEN,
    siteId: process.env.CINETPAY_SITE_ID,
    secret: process.env.CINETPAY_SECRET || "",
    baseUrl: process.env.CINETPAY_BASE_URL || "https://api-checkout.cinetpay.com/v2",
  };
}

const FEE_PCT = { orange: 1.5, mtn: 1.5, wave: 1.0, moov: 1.5 };

export function feeFor(amount, providerId) {
  return Math.round((amount * (FEE_PCT[providerId] ?? 1.5)) / 100);
}

export function makeRef(providerId) {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `${String(providerId).toUpperCase()}-${n}`;
}

async function chargeViaCinetPay({ amount, phone, provider, offerId, description }) {
  const { token, siteId, baseUrl } = cinetpayEnv();
  if (!token || !siteId) {
    throw new Error("PAYMENTS_MODE=reel mais CINETPAY_TOKEN ou CINETPAY_SITE_ID absent(e) — configure le .env du serveur.");
  }
  // CinetPay v2 — initie la transaction et renvoie un token de paiement.
  const body = new URLSearchParams({
    apikey: token,
    site_id: siteId,
    transaction_id: `koodo-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    amount: String(Math.round(amount)),
    currency: "XOF",
    channels: provider === "wave" ? "WAVE" : provider === "mtn" ? "MTN,MOOV" : "OM,MTN,MOOV",
    description: description || "Achat sur Koodo",
    customer_name: "Client",
    customer_phone_number: String(phone || "").replace(/\D/g, ""),
    notify_url: `${process.env.PUBLIC_BASE_URL || ""}/api/payments/webhook`,
    return_url: `${process.env.PUBLIC_BASE_URL || ""}/marche`,
  });
  const res = await fetch(`${baseUrl}/payment`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(`CinetPay échec ${res.status} : ${j?.message || "réponse inattendue"}`);
  }
  const j = await res.json();
  if (j?.code !== "201" && j?.data?.payment_token == null) {
    throw new Error(`CinetPay refusé : ${j?.message || j?.description || "code " + j?.code}`);
  }
  return j.data?.payment_token || makeRef(provider);
}

export async function chargePayment({ amount, phone, provider, offerId, description }) {
  if (realMode()) {
    const ref = await chargeViaCinetPay({ amount, phone, provider, offerId, description });
    return { ref, mode: "reel" };
  }
  // Mode sandbox : simule la latence d'initiation, aucune somme débitée.
  await delay(1400);
  return { ref: makeRef(provider), mode: "sandbox" };
}

// Vérification de la notification webhook CinetPay.
// TODO production : comparer la signature reçue (en-tête CinetPay)
// avec le HMAC calculé depuis CINETPAY_SECRET avant de marquer la
// transaction comme payée. Ne jamais valider un paiement non vérifié.
export function verifyWebhookSignature(_headers, _body) {
  if (!realMode()) return true;
  return false; // à implémenter avec votre clé (voir TODO ci-dessus)
}