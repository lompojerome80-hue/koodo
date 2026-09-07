import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { firebaseApp } from "./config";
import type { User, Role } from "../types";

export type FBUser = import("firebase/auth").User;

let _auth: ReturnType<typeof getAuth> | null = null;
export function authc() {
  const app = firebaseApp();
  if (!_auth) _auth = getAuth(app);
  return _auth;
}

export function deriveEmail(identifier: string) {
  if (identifier.includes("@")) return identifier.trim().toLowerCase();
  const digits = identifier.replace(/\D/g, "");
  return `${digits}@koodo.app`;
}

export function mapFirebaseUser(u: FBUser, profile?: Partial<User>): User {
  return {
    id: u.uid,
    full_name: profile?.full_name || u.displayName || "Producteur Koodo",
    phone: profile?.phone || u.phoneNumber || "",
    role: profile?.role || "producer",
    region: profile?.region || null,
    village: profile?.village || null,
    verified: profile?.verified || 0,
    ussd_code: profile?.ussd_code || null,
  };
}

export async function fbSignup(input: {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
  role: Role;
  region?: string;
  village?: string;
}) {
  const email = deriveEmail(input.email || input.phone);
  const cred = await createUserWithEmailAndPassword(authc(), email, input.password);
  return { uid: cred.user.uid, email };
}

export async function fbLogin(identifier: string, password: string) {
  const email = deriveEmail(identifier);
  const cred = await signInWithEmailAndPassword(authc(), email, password);
  return cred.user;
}

export async function fbLogout() {
  await signOut(authc());
}

export function fbOnAuth(cb: (u: FBUser | null) => void) {
  return onAuthStateChanged(authc(), cb);
}