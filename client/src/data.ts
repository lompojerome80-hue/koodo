import { isFirebaseConfigured } from "./firebase/config";
import { demoBackend } from "./db/demo";
import { firestoreBackend, fbOnUserChange as fbOC } from "./db/firestore";
import type { DataBackend } from "./db/types";

export type { DataBackend } from "./db/types";
export type {
  StartPaymentInput,
  Thread,
  Msg,
  Tx,
  RegisterInput,
  NewOffer,
} from "./db/types";
export type {
  ProviderId,
  Provider,
} from "./payments/providers";

export const data: DataBackend = isFirebaseConfigured() ? firestoreBackend : demoBackend;
export const dbMode: "firebase" | "demo" = isFirebaseConfigured() ? "firebase" : "demo";

export function onUserChange(cb: (u: { uid: string } | null) => void): () => void {
  if (!isFirebaseConfigured()) return () => {};
  return fbOC(cb as any);
}