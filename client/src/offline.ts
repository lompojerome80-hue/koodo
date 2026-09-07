import { openDB, type IDBPDatabase } from "idb";

interface PendingOffer {
  id: string;
  cropId: string;
  quantity: number;
  unitPrice: number;
  createdAt: string;
  latency?: null;
  image?: string;
}
interface CachedPrices {
  cropId: string;
  data: { price: number; market: string }[];
  ts: number;
}

export interface Purchase {
  id: string;
  offer_id: string;
  provider: string;
  provider_name: string;
  amount: number;
  fee: number;
  total: number;
  buyer_id: string;
  buyer_name: string;
  buyer_phone: string;
  status: string;
  ref?: string;
  created_at: string;
  qtyKg?: number;
  items?: Array<{ offerId: string; cropName: string; emoji?: string; qtyKg: number; unitPrice: number; amount: number }>;
  delivery?: { lat: number; lng: number; label: string; note?: string };
  order_status?: "escrow" | "delivered" | "disputed";
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB("koodo-offline", 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("queue")) {
          db.createObjectStore("queue", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("prices")) {
          db.createObjectStore("prices", { keyPath: "cropId" });
        }
        if (!db.objectStoreNames.contains("offers")) {
          db.createObjectStore("offers", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("purchases")) {
          db.createObjectStore("purchases", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export const offline = {
  async queueOffer(o: PendingOffer) {
    const db = await getDB();
    await db.put("queue", o);
  },
  async listQueue() {
    const db = await getDB();
    return (await db.getAll("queue")) as PendingOffer[];
  },
  async dropQueue(id: string) {
    const db = await getDB();
    await db.delete("queue", id);
  },
  async cachePrices(cropId: string, data: unknown) {
    const db = await getDB();
    await db.put("prices", { cropId, data, ts: Date.now() } as CachedPrices);
  },
  async cachedPrices(cropId: string) {
    const db = await getDB();
    return (await db.get("prices", cropId)) as CachedPrices | undefined;
  },
  async saveOfferLocal(o: PendingOffer) {
    const db = await getDB();
    await db.put("offers", o);
  },
  async localOffers() {
    const db = await getDB();
    return (await db.getAll("offers")) as PendingOffer[];
  },
  async savePurchase(p: Purchase) {
    const db = await getDB();
    await db.put("purchases", p);
  },
  async listPurchases() {
    const db = await getDB();
    return (await db.getAll("purchases")) as Purchase[];
  },
};
