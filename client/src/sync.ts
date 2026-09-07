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
      // stay queued, retry later
      break;
    }
  }
  return synced;
}