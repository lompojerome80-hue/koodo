// ============================================================
// Paiements mobiles africains — mode SANDBOX / démo.
//
// Les providers suivants reproduisent le parcours exact d'un
// paiement Mobile Money. Rien n'est réellement débité : tout
// est simulé pour pouvoir tester l'application de bout en bout.
//
// Intégration réelle (production) — remplacer `simulatePay` :
//   Orange Money CI  : API Orange Money Africa (opérateur)
//   MTN MoMo         : API MTN Open API ("MoMo Payment")
//   Wave             : API Wave Business
//   Moov             : API Moov Money (via agrégateurs Côte d'Ivoire)
//   Tous             : passerelle unique Flutterwave / CinetPay / PayDunya
//       ex. Flutterwave : POST /charges { type:"mobile_money_franco",
//                           amount, currency:"XOF", phone_number, network }
//   keep : votre clé privée puis vérifiez via webhook la confirmation.
// ============================================================

export type ProviderId = "orange" | "mtn" | "wave" | "moov";

export interface Provider {
  id: ProviderId;
  name: string;
  short: string;
  color: string;
  logo: string;
  feePct: number;
  ussd: string;
  hint: string;
  countries: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: "orange",
    name: "Orange Money",
    short: "OM",
    color: "var(--om)",
    logo: "OM",
    feePct: 1.5,
    ussd: "#144#",
    hint: "Compose #144# sur ton téléphone",
    countries: "Côte d'Ivoire · Cameroun · Sénégal · Mali · BFA",
  },
  {
    id: "mtn",
    name: "MTN Mobile Money",
    short: "MTN",
    color: "var(--mtn)",
    logo: "MTN",
    feePct: 1.5,
    ussd: "#133#",
    hint: "Compose #133# sur ton téléphone",
    countries: "Côte d'Ivoire · Cameroun · Ghana · RDC · Ouganda",
  },
  {
    id: "wave",
    name: "Wave",
    short: "WV",
    color: "var(--wave)",
    logo: "WV",
    feePct: 1.0,
    ussd: "*878#",
    hint: "Depuis l'appli Wave ou *878#",
    countries: "Sénégal · Côte d'Ivoire · Mali · BFA · Togo",
  },
  {
    id: "moov",
    name: "Moov Money",
    short: "MV",
    color: "var(--moov)",
    logo: "MV",
    feePct: 1.5,
    ussd: "#155#",
    hint: "Compose #155# sur ton téléphone",
    countries: "Côte d'Ivoire · Bénin · Togo · Niger · Gabon",
  },
];

export function getProvider(id: string): Provider {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

export function feeFor(amount: number, provider: Provider): number {
  return Math.round((amount * provider.feePct) / 100);
}

export function makeTicketRef(provider: string): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `${provider.toUpperCase()}-${n}`;
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8;
}

/**
 * SIMULATION SANDBOX du paiement Mobile Money.
 * Retourne une référence de transaction après un délai court.
 * (En production : appeler l'API opérateur / passerelle et
 *  confirmer via webhook avant de valider.)
 */
export async function simulatePay(args: {
  provider: Provider;
  amount: number;
  phone: string;
}): Promise<{ ref: string }> {
  if (!isValidPhone(args.phone)) {
    throw new Error(`Numéro invalide pour ${args.provider.name}. Il faut 8 chiffres au minimum.`);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 1400));
  return { ref: makeTicketRef(args.provider.id) };
}