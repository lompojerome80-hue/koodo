import { Router } from "express";
import db from "../db.js";
import { nanoid } from "nanoid";

// Route compatible avec les passerelles USSD (Arkesel, Africa's Talking,
// B2B opérateurs CI : Orange / MTN / Moov). Chaque passerelle appelle
// GET ou POST avec { sessionId, msisdn, input } et attend une réponse
// préfixée "CON " (menu, l'utilisateur répond encore) ou "END " (fin).
//
// Flux : le producteur compose #144#, saisit son code personnel (ussd_code)
// puis navigue dans un menu textuel. Aucun accès internet requis.

const router = Router();

// Mémoire de session (par passerelle : sessionId) — états de navigation.
const sessions = new Map();
const TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.ts > TTL_MS) sessions.delete(k);
}, 60 * 1000);

const S = {
  HOME: "home",
  PRICE_CROP: "price_crop",
  PRICE_MARKET: "price_market",
  SELL_CROP: "sell_crop",
  SELL_QTY_PRICE: "sell_qty_price",
  ALERT_CROP: "alert_crop",
  MY_OFFERS: "my_offers",
};

function topPrices(limit = 5) {
  return db.prepare(
    `SELECT c.id AS crop_id, c.name AS crop_name, c.emoji,
            MIN(p.avg_price) AS best, p.market_id
     FROM prices p JOIN crops c ON c.id=p.crop_id
     WHERE p.report_count >= 0
     GROUP BY c.id
     ORDER BY p.recorded_at DESC LIMIT ?`
  ).all(limit);
}

function pricesForCrop(cropId) {
  return db.prepare(
    `SELECT m.name AS market, p.avg_price, p.updated_at
     FROM prices p JOIN markets m ON m.id=p.market_id
     WHERE p.crop_id=? ORDER BY p.avg_price ASC`
  ).all(cropId);
}

function cropList() {
  return db.prepare("SELECT id, name, emoji FROM crops ORDER BY name").all();
}

function cropName(cropId) {
  return db.prepare("SELECT name, emoji FROM crops WHERE id=?").get(cropId);
}

function userOffers(userId) {
  return db.prepare(
    `SELECT o.id, c.name AS crop_name, c.emoji, o.quantity, o.unit_price, o.status
     FROM offers o JOIN crops c ON c.id=o.crop_id WHERE o.user_id=? ORDER BY o.created_at DESC`
  ).all(userId);
}

function formatPrice(p) {
  return `${p.avg_price} F (${p.market})`;
}

// Menu principal.
function homeMenu(user) {
  const lines = ["KOODO — Bonjour " + (user?.full_name || "").split(" ")[0]];
  lines.push("1 Prix du jour");
  lines.push("2 Publier une annonce");
  lines.push("3 Alerte prix");
  lines.push("4 Mes annonces");
  lines.push("0 Quitter");
  return lines.join("\n");
}

function handle(req, res) {
  const sessionId = String(req.query.sessionId || req.body?.sessionId || Date.now());
  const msisdn = String(req.query.msisdn || req.body?.msisdn || "");
  const input = String(req.query.input ?? req.body?.input ?? "").trim();
  const now = Date.now();

  let st = sessions.get(sessionId) || { s: S.HOME, userId: null, crop: null, ts: now };

  // --- Identification par code personnel (ussd_code) au premier appel. ---
  if (!st.userId) {
    const user = input ? db.prepare("SELECT * FROM users WHERE ussd_code=? OR phone=?").get(input, msisdn) : null;
    if (!st.s && !input) st.s = S.HOME; // premier appel, pas encore de saisie
    if (!user) {
      // Premier appel : demander le code.
      if (!input || (!st.s && input === "")) {
        st.s = S.HOME;
        sessions.set(sessionId, { ...st, ts: now });
        return res.send("CON " + [
          "KOODO Agricole 🇨🇮",
          "Bienvenue !",
          "",
          "Entre ton code personnel",
          "(ou compose #144# depuis)",
          "ta ligne enregistrée)",
        ].join("\n"));
      }
      sessions.delete(sessionId);
      return res.send("END Code inconnu. Contacte ton appui local KOODO pour obtenir ton code.");
    }
    st.userId = user.id;
    st.user = { id: user.id, full_name: user.full_name, role: user.role, region: user.region };
    st.s = S.HOME;
    sessions.set(sessionId, { ...st, ts: now });
    return res.send("CON " + homeMenu(st.user));
  }

  // --- Navigation du menu. ---
  let out = "";
  let end = false;

  if (st.s === S.HOME) {
    switch (input) {
      case "1":
        st.s = S.PRICE_CROP;
        out = ["Prix du jour", "", ...cropList().map((c, i) => `${i + 1} ${c.emoji} ${c.name}`), "0 Retour"].join("\n");
        break;
      case "2":
        st.s = S.SELL_CROP;
        out = ["Publier une annonce", "", ...cropList().map((c, i) => `${i + 1} ${c.emoji} ${c.name}`), "0 Retour"].join("\n");
        break;
      case "3":
        st.s = S.ALERT_CROP;
        out = ["Créer une alerte prix", "", ...cropList().map((c, i) => `${i + 1} ${c.emoji} ${c.name}`), "0 Retour"].join("\n");
        break;
      case "4":
        st.s = S.MY_OFFERS;
        {
          const offs = userOffers(st.userId);
          if (!offs.length) {
            st.s = S.HOME;
            end = true;
            out = "Tu n'as pas encore d'annonce.\nAppelle le *1* du menu principal pour en publier une.";
          } else {
            out = ["Mes annonces", "", ...offs.map((o) => `${o.emoji} ${o.crop_name} — ${o.quantity} kg à ${o.unit_price} F/kg [${o.status}]`), "0 Retour"].join("\n");
          }
        }
        break;
      case "0":
        end = true;
        out = "Merci ! À très vite sur KOODO 🥭";
        break;
      default:
        out = homeMenu(st.user);
        break;
    }
  } else if (st.s === S.PRICE_CROP) {
    if (input === "0") {
      st.s = S.HOME; out = homeMenu(st.user);
    } else {
      const crops = cropList();
      const c = crops[Number(input) - 1];
      if (!c) {
        out = "Choix invalide.\n0 Retour";
      } else {
        st.s = S.PRICE_MARKET; st.crop = c;
        const prices = pricesForCrop(c.id);
        out = [`${c.emoji} ${c.name} (F/kg)`, "", ...prices.map((p, i) => `${i + 1}. ${p.market}: ${p.avg_price} F`), "", "0 Retour"].join("\n");
      }
    }
  } else if (st.s === S.PRICE_MARKET) {
    if (input === "0") {
      st.s = S.HOME; st.crop = null; out = homeMenu(st.user);
    } else {
      st.s = S.HOME; out = homeMenu(st.user);
      end = true;
      out = [`${st.crop.emoji} ${st.crop.name}`, ...pricesForCrop(st.crop.id).map((p) => `${p.market}: ${p.avg_price} F/kg`), "", "Merci, bonne vente ! 🥭"].join("\n");
    }
  } else if (st.s === S.SELL_CROP) {
    if (input === "0") {
      st.s = S.HOME; out = homeMenu(st.user);
    } else {
      const c = cropList()[Number(input) - 1];
      if (!c) {
        out = "Choix invalide.\n0 Retour";
      } else {
        st.s = S.SELL_QTY_PRICE; st.crop = c;
        out = `Publier ${c.emoji} ${c.name}\nEntre : quantité prixMin prixMax\n(ex : 500 150 200)`;
      }
    }
  } else if (st.s === S.SELL_QTY_PRICE) {
    if (input === "0") {
      st.s = S.HOME; st.crop = null; out = homeMenu(st.user);
    } else {
      const parts = input.split(/[\s,;]+/).map(Number);
      const [qty, price] = parts;
      if (!qty || !price || qty <= 0 || price <= 0) {
        out = "Format incorrect.\nEntre : quantité prixMin prixMax\n(ex : 500 150 200)\n0 Retour";
      } else {
        try {
          db.prepare(
            "INSERT INTO offers (id, user_id, crop_id, quantity, unit_price, status, created_at, updated_at) VALUES (?,?,?,?,?,'open',datetime('now'),datetime('now'))"
          ).run(nanoid(), st.userId, st.crop.id, Number(qty), Number(price));
          st.s = S.HOME; st.crop = null;
          end = true;
          out = `Annonce publiée 💪\n${st.crop.emoji} ${st.crop.name}\n${qty} kg à ${price} F/kg\nVisible par les acheteurs !`;
        } catch {
          out = "Erreur serveur. Réessaie.\n0 Retour";
        }
      }
    }
  } else if (st.s === S.ALERT_CROP) {
    if (input === "0") {
      st.s = S.HOME; out = homeMenu(st.user);
    } else {
      const c = cropList()[Number(input) - 1];
      if (!c) {
        out = "Choix invalide.\n0 Retour";
      } else {
        st.s = S.HOME;
        end = true;
        // Alerte simple : prix cible = meilleur prix actuel - 5 % (sur les 3 marchés min).
        const t = topPrices(3).find((x) => x.crop_id === c.id);
        const target = t ? Math.max(10, Math.round(t.best * 0.95)) : 100;
        db.prepare(
          "INSERT INTO alerts (id, user_id, crop_id, target_price, active, created_at) VALUES (?,?,?,?,1,datetime('now'))"
        ).run(nanoid(), st.userId, c.id, target);
        out = `Alerte créée ✓\n${c.emoji} ${c.name}\nJe t'avertis si le prix passe sous ${target} F/kg.`;
      }
    }
  } else if (st.s === S.MY_OFFERS) {
    if (input === "0") {
      st.s = S.HOME; out = homeMenu(st.user);
    } else {
      st.s = S.HOME; out = homeMenu(st.user);
    }
  } else {
    st.s = S.HOME; out = homeMenu(st.user);
  }

  sessions.set(sessionId, { ...st, ts: now });
  res.send((end ? "END " : "CON ") + out);
}

router.get("/", handle);
router.post("/", handle);

export default router;