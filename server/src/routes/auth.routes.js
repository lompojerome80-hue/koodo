import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import jwt from "jsonwebtoken";
import db from "../db.js";
import { signToken, signOtpToken, authRequired, JWT_SECRET } from "../auth.js";
import { sendOtp } from "../services/otp-delivery.js";
import { saveDataUrl } from "../uploads.js";

const router = Router();
const VALID_ROLES = ["producer", "buyer", "courier", "admin"];
const normalizePhone = (p) => String(p || "").replace(/[\s\-().]/g, "");

// Téléphone de repli (déterministe) pour un compte Google sans numéro renseigné :
// évite une contrainte NOT NULL/unique et reste stable pour les reconnexions.
function googleFallbackPhone(sub) {
  const h = crypto.createHash("sha1").update(String(sub || "google")).digest("hex");
  const digits = h.replace(/\D/g, "").slice(0, 9).padEnd(9, "0");
  return "+226" + digits;
}

const safeUser = (user) => ({
  id: user.id,
  full_name: user.full_name,
  phone: user.phone,
  email: user.email || null,
  auth_provider: user.auth_provider || "sms",
  role: user.role,
  region: user.region,
  village: user.village,
  locality: user.locality || null,
  transport: user.transport || null,
  selfie: user.selfie || null,
  id_front: user.id_front || null,
  id_back: user.id_back || null,
  doc_status: user.doc_status || "pending",
  doc_updated_at: user.doc_updated_at || null,
  verified: user.verified,
  ussd_code: user.ussd_code,
  blocked: user.blocked,
  blocked_reason: user.blocked_reason,
});

/** Exigence du compte : mot de passe fort (8+, 1 majuscule, 1 minuscule, 1 chiffre). */
function assertStrongPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "8 caractères minimum";
  }
  if (!/[A-Z]/.test(password)) return "au moins une lettre majuscule";
  if (!/[a-z]/.test(password)) return "au moins une lettre minuscule";
  if (!/[0-9]/.test(password)) return "au moins un chiffre";
  return null;
}

const COURIER_FIELDS = ["locality", "transport", "selfie", "id_front", "id_back"];

/** Traduit en URL les photos (dataURL) envoyées à la création / mise à jour du dossier. */
function storeCourierPhotos(payload) {
  const out = {};
  for (const f of ["selfie", "id_front", "id_back"]) {
    if (typeof payload?.[f] === "string" && payload[f]) out[f] = saveDataUrl(payload[f], "courier");
  }
  return out;
}

/** Un livreur doit avoir fourni localité, moyen de déplacement et ses photos. */
function courierDossierComplete(u) {
  return [u.locality, u.transport, u.selfie, u.id_front, u.id_back].every(Boolean);
}

function assertCourierDossier(req) {
  const row = db.prepare("SELECT locality, transport, selfie, id_front, id_back FROM users WHERE id = ?").get(req.user?.sub);
  if (row && !courierDossierComplete(row)) {
    const err = new Error(
      "Dossier livreur incomplet — ajoute localité, moyen de déplacement, ta photo et ta pièce d'identité (recto + verso)"
    );
    err.status = 403;
    throw err;
  }
}

router.post("/register", (req, res) => {
  const { fullName, phone, password, role, region, village } = req.body || {};
  if (!fullName || !phone || !password) {
    return res.status(400).json({ error: "Nom, téléphone et mot de passe requis" });
  }
  const pwIssue = assertStrongPassword(password);
  if (pwIssue) return res.status(400).json({ error: `Mot de passe trop faible : ${pwIssue}` });
  const exists = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
  if (exists) return res.status(409).json({ error: "Ce numéro est déjà enregistré" });
  const validRole = VALID_ROLES.includes(role) ? role : "producer";
  const id = nanoid();
  const hash = bcrypt.hashSync(password, 10);
  let photos;
  if (validRole === "courier") {
    if (!req.body?.locality || !req.body?.transport) {
      return res.status(400).json({ error: "Le compte livreur exige ta localité et ton moyen de déplacement" });
    }
    try {
      photos = storeCourierPhotos(req.body || {});
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!photos.selfie || !photos.id_front || !photos.id_back) {
      return res.status(400).json({ error: "Le compte livreur exige ta photo et ta pièce d'identité (recto + verso)" });
    }
  }
  db.prepare(
    `INSERT INTO users (id, full_name, phone, password, role, region, village,
        auth_provider, locality, transport, selfie, id_front, id_back, doc_status, verified)
     VALUES (?,?,?,?,?,?,?, 'sms', ?, ?, ?, ?, ?, 'pending', 0)`
  ).run(
    id, fullName, phone, hash, validRole, region || null, village || null,
    photos?.locality ?? req.body?.locality ?? null,
    photos?.transport ?? req.body?.transport ?? null,
    photos?.selfie ?? null,
    photos?.id_front ?? null,
    photos?.id_back ?? null
  );
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  res.status(201).json({ token: signToken(user), user: safeUser(user) });
});

// ============================================================
// Création de compte par authentification Google (méthode principale).
// En Firebase, le client s'authentifie auprès de Google puis appelle
// /google/register avec l'identité. En démo (pas de Firebase), le client
// obtient un "draft" simulé : celui-ci ouvre un compte identique.
// ============================================================
router.post("/google/draft", (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim();
  const name = String(req.body?.name || "").trim();
  if (!email || !name) return res.status(400).json({ error: "Profil Google requis" });
  const existing = db.prepare("SELECT * FROM users WHERE email = ? OR google_uid = ?").get(email, `g:${email}`);
  if (existing) {
    return res.json({ existing: true, token: signToken(existing), user: safeUser(existing) });
  }
  const draftToken = signOtpToken({ sub: `g:${email}`, email, name, purpose: "google_register" });
  res.json({ existing: false, draftToken, draftName: name, draftEmail: email, draftPhoto: req.body?.photo || null });
});

router.post("/google/register", (req, res) => {
  const { draftToken, fullName, phone, role, region, village } = req.body || {};
  if (!draftToken || !fullName) return res.status(400).json({ error: "Token Google et nom requis" });
  let payload;
  try {
    payload = jwt.verify(draftToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Session Google expirée — reconnecte-toi" });
  }
  if (payload.purpose !== "google_register" || !payload.sub) {
    return res.status(401).json({ error: "Session Google invalide" });
  }
  if (db.prepare("SELECT id FROM users WHERE google_uid = ?").get(payload.sub)) {
    return res.status(409).json({ error: "Ce compte Google est déjà enregistré — connecte-toi" });
  }
  const validRole = VALID_ROLES.includes(role) ? role : "producer";
  let photos = {};
  let courierDocs = {};
  if (validRole === "courier") {
    if (!req.body?.locality || !req.body?.transport) {
      return res.status(400).json({ error: "Le compte livreur exige ta localité et ton moyen de déplacement" });
    }
    try {
      photos = storeCourierPhotos(req.body || {});
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!photos.selfie || !photos.id_front || !photos.id_back) {
      return res.status(400).json({ error: "Le compte livreur exige ta photo et ta pièce d'identité (recto + verso)" });
    }
    courierDocs = { locality: req.body.locality, transport: req.body.transport };
  }
  const id = nanoid();
  const randomPw = bcrypt.hashSync(nanoid(32), 10);
  db.prepare(
    `INSERT INTO users (id, full_name, phone, password, role, region, village,
        auth_provider, google_uid, email, locality, transport, selfie, id_front, id_back, doc_status, verified, avatar)
     VALUES (?,?,?,?,?,?,?, 'google', ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?)`
  ).run(
    id,
    fullName,
    phone ? normalizePhone(phone) : googleFallbackPhone(payload.sub),
    randomPw,
    validRole,
    region || null,
    village || null,
    payload.sub,
    payload.email,
    courierDocs.locality ?? null,
    courierDocs.transport ?? null,
    photos.selfie ?? null,
    photos.id_front ?? null,
    photos.id_back ?? null,
    req.body?.photo || null
  );
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  res.status(201).json({ token: signToken(user), user: safeUser(user) });
});

// Le livreur met à jour son dossier (localité, moyen de déplacement, photos).
// Une pièce d'identité déjà fournie ne peut PAS être supprimée : elle ne peut
// être que remplacée (nouvelle photo). Empty/null = conserver l'existant.
router.patch("/me/courier", authRequired, (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);
  if (!u) return res.status(404).json({ error: "Compte introuvable" });
  if (u.role !== "courier") return res.status(403).json({ error: "Réservé aux livreurs" });
  if (req.body?.locality === "") return res.status(400).json({ error: "La localité ne peut pas être vide" });
  if (req.body?.transport === "") return res.status(400).json({ error: "Le moyen de déplacement ne peut pas être vide" });
  let photos = {};
  try {
    photos = storeCourierPhotos(req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const final = {
    locality: req.body?.locality ? String(req.body.locality).slice(0, 120) : u.locality,
    transport: req.body?.transport ? String(req.body.transport).slice(0, 40) : u.transport,
    selfie: photos.selfie || u.selfie,
    id_front: photos.id_front || u.id_front,
    id_back: photos.id_back || u.id_back,
  };
  if (!courierDossierComplete(final)) {
    return res.status(400).json({ error: "Dossier incomplet : localité, moyen de déplacement, photo et pièce d'identité exigés" });
  }
  const changedDoc = Object.keys(photos).length > 0;
  db.prepare(
    `UPDATE users SET locality = ?, transport = ?, selfie = ?, id_front = ?, id_back = ?,
       doc_status = CASE WHEN ? THEN 'pending' ELSE doc_status END,
       doc_updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(final.locality, final.transport, final.selfie, final.id_front, final.id_back, changedDoc ? 1 : 0, req.user.sub);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);
  res.json({ ok: true, user: safeUser(user) });
});

router.post("/login", (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: "Téléphone et mot de passe requis" });
  const user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Téléphone ou mot de passe incorrect" });
  }
  const safe = safeUser(user);
  res.json({ token: signToken(user), user: safe });
});

// ============================================================
// Connexion / inscription par WhatsApp (code OTP)
// En production (OTP_MODE=whatsapp) : le code est envoyé via
// l'API Meta WhatsApp Business Cloud (template "koodo_otp").
// En mode démo (défaut), il est renvoyé à l'application (devCode)
// et affiché à l'écran. Voir services/otp-delivery.js.
// ============================================================
router.post("/otp/request", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: "Numéro de téléphone requis" });
  const recent = db
    .prepare("SELECT COUNT(*) n FROM otp_codes WHERE phone=? AND used=0 AND expires_at > datetime('now')")
    .get(phone);
  if (recent.n >= 5) return res.status(429).json({ error: "Trop de demandes — réessaie dans quelques minutes" });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare("INSERT INTO otp_codes (phone, code, expires_at) VALUES (?,?, datetime('now','+10 minutes'))").run(phone, code);
  try {
    const sent = await sendOtp({ phone, code });
    res.json({ message: sent.delivered ? "Code envoyé par WhatsApp" : "Code envoyé par WhatsApp", devCode: sent.devCode, expiresIn: 600 });
  } catch (err) {
    if (req.app.get("env") !== "production") console.error("[otp]", err.message);
    res.status(500).json({ error: "Impossible d'envoyer le code — configure WHATSAPP_TOKEN/WHATSAPP_PHONE_ID" });
  }
});

router.post("/otp/verify", (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || "").trim();
  if (!phone || !code) return res.status(400).json({ error: "Téléphone et code requis" });
  const row = db
    .prepare("SELECT * FROM otp_codes WHERE phone=? AND code=? AND used=0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1")
    .get(phone, code);
  if (!row) return res.status(401).json({ error: "Code incorrect ou expiré" });
  db.prepare("UPDATE otp_codes SET used=1 WHERE id=?").run(row.id);
  const user = db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
  if (user) {
    return res.json({ existing: true, token: signToken(user), user: safeUser(user) });
  }
  res.json({ existing: false, otpToken: signOtpToken({ sub: phone, purpose: "otp_register" }) });
});

router.post("/register/otp", (req, res) => {
  const { otpToken, fullName, role, region, village } = req.body || {};
  if (!otpToken || !fullName) return res.status(400).json({ error: "Token OTP et nom requis" });
  let payload;
  try {
    payload = jwt.verify(otpToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Vérification expirée — redemande un code" });
  }
  if (payload.purpose !== "otp_register" || !payload.sub) return res.status(401).json({ error: "Vérification invalide" });
  const phone = payload.sub;
  if (db.prepare("SELECT id FROM users WHERE phone=?").get(phone)) {
    return res.status(409).json({ error: "Ce numéro est déjà enregistré — connecte-toi" });
  }
  const validRole = VALID_ROLES.includes(role) ? role : "producer";
  const id = nanoid();
  let photos = {};
  if (validRole === "courier") {
    if (!req.body?.locality || !req.body?.transport) {
      return res.status(400).json({ error: "Le compte livreur exige ta localité et ton moyen de déplacement" });
    }
    try {
      photos = storeCourierPhotos(req.body || {});
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!photos.selfie || !photos.id_front || !photos.id_back) {
      return res.status(400).json({ error: "Le compte livreur exige ta photo et ta pièce d'identité (recto + verso)" });
    }
  }
  db.prepare("INSERT INTO users (id, full_name, phone, password, role, region, village, locality, transport, selfie, id_front, id_back, doc_status, verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)")
    .run(id, fullName, phone, bcrypt.hashSync(nanoid(24), 10), validRole,
      region || null, village || null,
      req.body?.locality ?? null, req.body?.transport ?? null,
      photos.selfie ?? null, photos.id_front ?? null, photos.id_back ?? null, validRole === "courier" ? "pending" : "pending");
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(id);
  res.status(201).json({ token: signToken(user), user: safeUser(user) });
});

router.get("/me", authRequired, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
  res.json({ user: safeUser(user) });
});

router.patch("/me", authRequired, (req, res) => {
  const { region, village, fullName } = req.body || {};
  db.prepare("UPDATE users SET region = COALESCE(?, region), village = COALESCE(?, village), full_name = COALESCE(?, full_name) WHERE id = ?")
    .run(region ?? null, village ?? null, fullName ?? null, req.user.sub);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);
  res.json({ user: safeUser(user) });
});

// ============================================================
// Suppression du compte (exigence Google Play).
// Le compte est anonymisé de façon irréversible : plus aucune donnée
// identifiante n'est conservée et le numéro de téléphone est libéré (possible
// réinscription). Les lignes financières (transactions, courses, dûs) sont
// conservées pour la comptabilité, comme l'exige la réglementation.
// ============================================================
router.post("/delete-account", authRequired, (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Mot de passe requis pour supprimer le compte" });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);
  if (!user) return res.status(404).json({ error: "Compte introuvable" });
  if (user.anonymized) return res.status(409).json({ error: "Compte déjà supprimé" });
  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Mot de passe incorrect" });
  }
  const id = user.id;
  db.transaction(() => {
    // Demandes d'aide, alertes, cloche, file de synchro : purge totale.
    db.prepare("DELETE FROM support_messages WHERE sender_id = ?").run(id);
    db.prepare("DELETE FROM support_threads WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM notifications WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM alerts WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM sync_queue WHERE user_id = ?").run(id);
    // Signalements émis par l'utilisateur et reçus sur ses annonces.
    db.prepare("DELETE FROM reports WHERE reporter_id = ?").run(id);
    db.prepare("DELETE FROM reports WHERE offer_id IN (SELECT id FROM offers WHERE user_id = ?)").run(id);
    // Notifications liées aux annonces de l'utilisateur (ex. commande passée par
    // un acheteur) — les offres étant supprimées, ces références sauteraient.
    db.prepare("DELETE FROM notifications WHERE offer_id IN (SELECT id FROM offers WHERE user_id = ?)").run(id);
    // Messages envoyés + annonces sans transaction (les annonces achetées sont
    // conservées clôturées, car les transactions y font référence).
    db.prepare("DELETE FROM messages WHERE sender_id = ?").run(id);
    db.prepare(
      `DELETE FROM offers WHERE user_id = ? AND id NOT IN (SELECT DISTINCT offer_id FROM transactions WHERE offer_id IS NOT NULL)`
    ).run(id);
    db.prepare("UPDATE offers SET status = 'cancelled', updated_at = datetime('now') WHERE user_id = ? AND status = 'open'").run(id);
    // Blocages : plus d'objet après la suppression.
    db.prepare("DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?").run(id, id);
    // Anonymisation : identité neutralisée, numéro libéré, compte inactivable.
    db.prepare(
      `UPDATE users SET full_name = 'Compte supprimé', phone = ?, password = ?, email = NULL, avatar = NULL,
         region = NULL, village = NULL, locality = NULL, transport = NULL,
         selfie = NULL, id_front = NULL, id_back = NULL, ussd_code = NULL, google_uid = NULL,
         anonymized = 1, deleted_at = datetime('now','localtime'),
         blocked = 1, blocked_reason = 'Compte supprimé par l''utilisateur'
       WHERE id = ?`
    ).run(`deleted_${id}`, bcrypt.hashSync(nanoid(32), 10), id);
  })();
  res.json({ ok: true });
});

export default router;
