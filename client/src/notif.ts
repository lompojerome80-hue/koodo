import { data } from "./data";
import { useApp } from "./store";

// Rafraîchit le centre de notifications depuis le backend actif (démo ou Firebase).
// Utilisé par le Shell (polling) et après toute action de livraison.
export async function refreshNotifications() {
  try {
    const n = await data.listNotifications();
    useApp.getState().setNotifications(n);
  } catch {
    // hors ligne ou backend indisponible : on garde l'état courant
  }
}

export async function markAllNotificationsRead() {
  try {
    await data.markNotificationsRead();
  } catch {
    // silencieux : pas bloquant
  }
  useApp.getState().setNotifications(
    useApp.getState().notifications.map((x) => ({ ...x, seen: true }))
  );
}