// ============================================================
// i18n minimal : Français, Mooré, Dioula.
// t() renvoie le texte de la langue courante, et retombe sur le
// français si la clé manque (les écrans restent utilisables en FR).
// ============================================================

export type Lang = "fr" | "moore" | "dioula";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "fr", label: "Français" },
  { id: "moore", label: "Mooré" },
  { id: "dioula", label: "Dioula" },
];

export const LANG_KEY = "koodo_lang";

const DICT: Record<string, Partial<Record<Lang, string>>> = {
  "nav.prix": { fr: "Prix", moore: "Raako", dioula: "Sàrì" },
  "nav.vendre": { fr: "Vendre", moore: "Koosgo", dioula: "Fèere" },
  "nav.achats": { fr: "Mes achats", moore: "M raabo", dioula: "N sànnu" },
  "nav.marche": { fr: "Marché", moore: "Kiuugu", dioula: "Sugu" },
  "nav.compte": { fr: "Compte", moore: "M zugu", dioula: "N ka tɔgɔ" },
  "nav.livraisons": { fr: "Livraisons", moore: "Tʋkri", dioula: "Sàn-ni" },
  "nav.admin": { fr: "Admin", moore: "Kãsmã", dioula: "Kun-tigi" },
  "tagline": {
    fr: "le prix du marché, même sans réseau",
    moore: "raako sẽn wat ne tʋm wa Dãmb ned ka be ye",
    dioula: "sàrì ka bɛ sugu la, nɛta ma bɛ fana",
  },
  "conn.online": { fr: "En ligne", moore: "Ne nett", dioula: "Nɛta bɛ" },
  "conn.offline": { fr: "Hors ligne — données en cache", moore: "Nett ka be — dãmb tiki", dioula: "Nɛta ma bɛ — data bɛ yɔrɔ" },

  "prices.search": { fr: "Rechercher un produit…", moore: "Bao bõn-yagre…", dioula: "Kà fɛrɛ ɲini…" },
  "prices.best": { fr: "meilleur prix aujourd'hui", moore: "raako sẽn yɩ neere rũndã", dioula: "sàrì ɲuman bi" },
  "prices.table": { fr: "Tableau des prix", moore: "Raako teebl", dioula: "Sàrì tabili" },
  "prices.live": { fr: "Prix en direct", moore: "Raako sẽn vɩt", dioula: "Sàrì ka bɛ kɛnɛ" },
  "prices.live.stale": { fr: "Prix en direct · mis à jour plus tard", moore: "Raako sẽn vɩt · na n yɩ ne ta-way", dioula: "Sàrì ka bɛ kɛnɛ · béni kɔninna" },
  "prices.report": { fr: "Signaler ce prix", moore: "Wilg raakã", dioula: "Kà sàrì fɔ" },
  "prices.report.note": {
    fr: "Ce prix sera publié après 2 signalements concordants (anti-fraude).",
    moore: "Raakã na n wilg tɩ ned a yi sõng a yet n sõmda a taab (anti-fraude).",
    dioula: "Sàrì in bɛna fɔ kɔ̀ni mɔgɔ fila ka a fɔ i ɲɔgɔn dji (anti-fraude).",
  },
  "prices.badge.best": { fr: "MEILLEUR", moore: "SÕMGO", dioula: "NYUMAN" },
  "prices.badge.community": { fr: "COMMUNAUTÉ", moore: "TĘNG-NEDBA", dioula: "MƆƆGƆ" },
  "prices.badge.near": { fr: "PRÈS DE TOI", moore: "PẼNGE NE FOO", dioula: "I FƐƐ" },
  "account.langue": { fr: "Langue", moore: "Gomde", dioula: "Kan" },
  "account.aide": { fr: "Besoin d'aide ?", moore: "F reega sõngre?", dioula: "I bɛ dɛmɛ fɛwa?" },
  "account.conversations": { fr: "Mes conversations", moore: "Mam gom-gao fog", dioula: "N ka pa-le sɛbɛ" },
  "account.logout": { fr: "Se déconnecter", moore: "Yi m zugu", dioula: "Kà bɔ" },
};

export function t(key: string, lang: Lang): string {
  const entry = DICT[key];
  if (entry) return entry[lang] ?? entry.fr ?? key;
  return key;
}