import { offline } from "./offline";
import { api } from "./api";

export async function flushOfflineQueue(): Promise<number> {
  const queue = await offline.listQueue();
  if (!queue.length) return 0;
  let synced = 0;
  for (const item of queue) {
    try {
      await api.post("/offers/sync", {
        offers: [
          {
            id: item.id,
            cropId: item.cropId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            createdAt: item.createdAt,
            image: item.image,
          },
        ],
      });
      await offline.dropQueue(item.id);
      synced++;
    } catch {
      // Une annonce bloquée ne doit pas empêcher les suivantes de partir :
      // on continue, et une nouvelle tentative périodique reprendra celle-ci.
    }
  }
  return synced;
}