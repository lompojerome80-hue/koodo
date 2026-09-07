import { api, setToken } from "../api";
import { dbMode } from "../data";
import { authc, deriveEmail, fbSignup } from "../firebase/auth";
import { dbc, userDoc } from "../db/firestore";
import {
  getDoc,
  doc,
  setDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { signInWithEmailAndPassword } from "firebase/auth";
import type { User, Role } from "../types";

export function normalizePhone(p: string) {
  return String(p || "").replace(/[\s\-().]/g, "");
}

const OTP_LS = "koodo_otp";

/**
 * Demande l'envoi d'un code par WhatsApp.
 * Démo : l'API Express génère le code (devCode affiché à l'écran).
 * Firebase : simulation locale (sandbox) — aucun message réel.
 * Production : envoyer via Meta WhatsApp Business Cloud API (template "koodo_otp").
 */
export async function whatOtpRequest(phoneRaw: string): Promise<{ devCode?: string; message: string }> {
  const phone = normalizePhone(phoneRaw);
  if (phone.length < 8) throw new Error("Numéro de téléphone invalide");
  if (dbMode === "demo") {
    return api.post<{ devCode?: string; message: string }>("/auth/otp/request", { phone });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const map = JSON.parse(localStorage.getItem(OTP_LS) || "{}");
  map[phone] = { code, exp: Date.now() + 10 * 60 * 1000 };
  localStorage.setItem(OTP_LS, JSON.stringify(map));
  return { message: "Code WhatsApp (simulation Firebase)", devCode: code };
}

export interface OtpVerifyResult {
  existing: boolean;
  user?: User;
  token?: string;
  otpToken?: string;
}

/** Vérifie le code : connecte si le compte existe, sinon prépare l'inscription. */
export async function whatOtpVerify(phoneRaw: string, code: string): Promise<OtpVerifyResult> {
  const phone = normalizePhone(phoneRaw);
  if (dbMode === "demo") {
    const res = await api.post<OtpVerifyResult>("/auth/otp/verify", { phone, code });
    if (res.existing && res.token) {
      setToken(res.token);
      return { existing: true, user: res.user };
    }
    return { existing: false, otpToken: res.otpToken };
  }

  const map = JSON.parse(localStorage.getItem(OTP_LS) || "{}");
  const rec = map[phone];
  if (!rec || rec.exp < Date.now()) throw new Error("Code expiré — redemande un code");
  if (rec.code !== code.trim()) throw new Error("Code incorrect");
  delete map[phone];
  localStorage.setItem(OTP_LS, JSON.stringify(map));

  const snap = await getDocs(query(collection(dbc(), "users"), where("phone", "==", phone)));
  if (!snap.empty) {
    const uid = snap.docs[0].id;
    const meta = await getDoc(doc(dbc(), "sandboxCreds", uid));
    const pw = meta.exists() ? meta.data().password : null;
    if (!pw) throw new Error("Ce numéro utilise Google — connecte-toi avec Google");
    await signInWithEmailAndPassword(authc(), deriveEmail(phone), pw);
    const profile = await userDoc(uid);
    return { existing: true, user: profile || undefined };
  }
  return { existing: false, otpToken: phone };
}

/** Finalise l'inscription WhatsApp (nom + rôle + dossier livreur). */
export async function whatOtpRegister(input: {
  otpToken: string;
  fullName: string;
  role: Role;
  region?: string;
  village?: string;
  locality?: string;
  transport?: string;
  selfie?: string;
  id_front?: string;
  id_back?: string;
}): Promise<User> {
  if (dbMode === "demo") {
    const res = await api.post<{ token: string; user: User }>("/auth/register/otp", {
      otpToken: input.otpToken,
      fullName: input.fullName,
      role: input.role,
      region: input.region,
      village: input.village,
      locality: input.locality,
      transport: input.transport,
      selfie: input.selfie,
      id_front: input.id_front,
      id_back: input.id_back,
    });
    setToken(res.token);
    return res.user;
  }
  const phone = input.otpToken;
  const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const { uid } = await fbSignup({
    fullName: input.fullName,
    phone,
    email: deriveEmail(phone),
    password,
    role: input.role,
    region: input.region,
    village: input.village,
  });
  const ussd = `SK-${uid.slice(0, 6).toUpperCase()}`;
  await setDoc(doc(dbc(), "users", uid), {
    fullName: input.fullName,
    phone,
    role: input.role,
    region: input.region || "Ouagadougou",
    village: input.village || null,
    locality: input.locality || null,
    transport: input.transport || null,
    selfie: input.selfie || null,
    idFront: input.id_front || null,
    idBack: input.id_back || null,
    docStatus: "pending",
    ussdCode: ussd,
    verified: 1,
    createdAt: serverTimestamp(),
  });
  // Identifiants conservés localement uniquement pour la simulation WhatsApp (sandbox).
  await setDoc(doc(dbc(), "sandboxCreds", uid), {
    email: deriveEmail(phone),
    password,
    createdAt: serverTimestamp(),
  });
  const profile = await userDoc(uid);
  if (!profile) throw new Error("Profil introuvable");
  return profile;
}