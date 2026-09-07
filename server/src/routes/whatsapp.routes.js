import { Router } from "express";
import db from "../db.js";

// Assistant WhatsApp du marché KOODO.
// 1) Meta valide le webhook via GET /webhook (hub.challenge).
// 2) POST /webhook reçoit les messages entrants, les analyse (intents
//    textuels : prix, aide…) et répond sur WhatsApp.
// En l'absence de WHATSAPP_TOKEN / WHATSAPP_PHONE_ID, le webhook répond
// en mode "simulé" (pas d'envoi réel) — testable sans compte WhatsApp.
//
// Variables : WHATSAPP_TOKEN (jeton API Meta), WHATSAPP_PHONE_ID,
// WHATSAPP_VERIFY_TOKEN (secret de vérification du webhook).

const router = Router();
const WHATSAPP = {
  token: process.env.WHATSAPP_TOKEN || "",
  phoneId: process.env.WHATSAPP_PHONE_ID || "",
  verify: process.env.WHATSAPP_VERIFY_TOKEN || "koodo",
};

function cropsIndex() {
  return db.prepare("SELECT id, name, emoji FROM crops").all();
}

function pricesForCrop(cropId) {
  return db.prepare(
    `SELECT m.name AS market, p.avg_price FROM prices p JOIN markets m ON m.id=p.market_id
     WHERE p.crop_id=? ORDER BY p.avg_price ASC LIMIT 6`
  ).all(cropId);
}

function findCrop(tokens) {
  const crops = cropsIndex();
  for (const t of tokens) {
    const hit = crops.find((c) => c.name.toLowerCase().startsWith(t) || t.startsWith(c.name.slice(0, 3).toLowerCase()) || c.id === t);
    if (hit) return hit;
  }
  return null;
}

// Analyse le texte reçu et produit la réponse.
function replyFor(text) {
  const t = (text || "").toLowerCase().trim();
  const tokens = t.split(/[^a-z0-9àâçéèêëîïôùûüÿ]+/i).filter(Boolean);

  if (!t || /^(bonjour|salut|hello|hi|bonsoir|aide|menu|help)$/.test(t)) {
    return [
      "🌾 KOODO — le marché agricole en direct.",
      "",
      "Envoie :",
      "• « prix mais » → les cours du jour",
      "• « prix igname » pour toute autre culture",
      "• « aide » pour revoir ce menu.",
    ].join("\n");
  }

  if (tokens.includes("aide") || tokens.includes("menu") || tokens.includes("help")) {
    return [
      "🌾 Comment t'aider ?",
      "",
      "• « prix <culture> » : les meilleurs cours",
      "• « publier <culture> <kg> <prix/kg> » : vends en 1 message",
      "• Un vendeur te répond rapidement par ici.",
    ].join("\n");
  }

  if ((tokens.includes("publier") || tokens.includes("vendre")) && tokens.length >= 4) {
    const crop = findCrop(tokens);
    // Format : publier <culture> <quantité> <prix>
    const nums = tokens.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!crop || nums.length < 2) {
      return ["Format : « publier mais 500 200 » (culture, quantité kg, prix/kg)."].join("\n");
    }
    const [qty, price] = nums;
    return [
      `✅ Reçu ! ${crop.emoji} ${crop.name}: ${qty} kg à ${price} F/kg.`,
      "",
      "Connecte-toi sur KOODO pour finaliser la publication (photos, localisation).",
    ].join("\n");
  }

  if (tokens.includes("prix") || tokens.includes("ou")) {
    const crop = findCrop(tokens);
    if (crop) {
      const ps = pricesForCrop(crop.id);
      if (!ps.length) return `${crop.emoji} Pas encore de relevé pour ${crop.name}.`;
      return [
        `${crop.emoji} ${crop.name} (F/kg)`,
        ...ps.map((p) => `${p.market}: ${p.avg_price}`),
        "Source : signalements producteurs du jour.",
      ].join("\n");
    }
    return ["Je n'ai pas trouvé cette culture. Essaie : « prix mais », « prix igname »…"].join("\n");
  }

  return [
    "Je ne comprends pas encore. Essaie :",
    "• « prix mais »",
    "• « aide »",
    "• « publier mais 500 200 »",
  ].join("\n");
}

async function sendWhatsApp(to, body) {
  const resp = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP.phoneId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP.token}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Meta API ${resp.status}: ${detail.slice(0, 200)}`);
  }
}

// Vérification du webhook par Meta (GET).
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === WHATSAPP.verify) return res.send(challenge);
  res.status(403).send("Invalid verify token");
});

// Messages entrants (POST).
router.post("/webhook", async (req, res) => {
  const entries = req.body?.entry || [];
  let simulatedReply = null;
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const msgs = change.value?.messages || [];
      for (const m of msgs) {
        if (m.type !== "text" && !m.text?.body) continue;
        const from = m.from;
        const reply = replyFor(m.text.body);
        if (WHATSAPP.token && WHATSAPP.phoneId) {
          try {
            await sendWhatsApp(from, reply);
          } catch (err) {
            console.error("[whatsapp] envoi échoué:", err.message);
          }
        } else {
          simulatedReply = reply;
        }
      }
    }
  }
  res.json({ ok: true, simulated: !!(simulatedReply && !WHATSAPP.token), ...(simulatedReply ? { reply: simulatedReply } : {}) });
});

export default router;