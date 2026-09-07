// ============================================================
// Envoi des codes OTP de connexion par WhatsApp.
//
// Deux modes, pilotés par l'environnement :
//   OTP_MODE=simulated  (DÉFAUT) — le code est renvoyé à
//                       l'application (devCode) et affiché à
//                       l'écran de démonstration. Aucun message
//                       n'est réellement envoyé.
//   OTP_MODE=whatsapp  — le code est envoyé via l'API Meta
//                       WhatsApp Business Cloud (template OTP
//                       approuvé). Ce mode exige :
//                         WHATSAPP_TOKEN       (token API Meta)
//                         WHATSAPP_PHONE_ID    (id du numéro métier)
//                         WHATSAPP_TEMPLATE    (nom du template OTP)
//                       En cas de clé absente, on refuse d'émettre
//                       le code : aucune fuite du code par l'API.
// ============================================================

const simulated = () => process.env.OTP_MODE !== "whatsapp";

function whatsappEnv() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const template = process.env.WHATSAPP_TEMPLATE || "koodo_otp";
  return { token, phoneId, template };
}

async function sendViaWhatsApp({ phone, code }) {
  const { token, phoneId, template } = whatsappEnv();
  if (!token || !phoneId) {
    throw new Error(
      "OTP_MODE=whatsapp mais WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID absent(e) — configure le .env du serveur."
    );
  }
  // https://developers.facebook.com/docs/whatsapp/cloud-api/messages
  // Body pré-rempli pour un template OTP à paramètre unique {{1}}.
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: { name: template, language: { code: "fr" }, components: [{ type: "body", parameters: [{ type: "text", text: String(code) }] }] },
  };
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(`Envoi WhatsApp échoué : ${res.status} ${err?.error?.message || ""}`);
  }
}

export async function sendOtp({ phone, code }) {
  if (simulated()) {
    // Mode démo : renvoie le code à l'application pour affichage à l'écran.
    return { delivered: false, devCode: code };
  }
  await sendViaWhatsApp({ phone, code });
  return { delivered: true, devCode: null };
}