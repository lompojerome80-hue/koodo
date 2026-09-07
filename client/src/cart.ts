import { create } from "zustand";
import type { Offer } from "./types";

export interface CartItem {
  offerId: string;
  cropName: string;
  emoji?: string;
  unitPrice: number;
  qtyKg: number;
  maxKg: number;
  seller: string;
  village?: string;
  image?: string;
}

interface CartState {
  items: CartItem[];
  add: (o: Offer, qtyKg?: number) => void;
  setQty: (offerId: string, qtyKg: number) => void;
  remove: (offerId: string) => void;
  clear: () => void;
}

const KEY = "koodo_cart";

function load(): CartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

const clampQty = (v: number, max: number) => Math.min(Math.max(1, Math.round(v * 10) / 10), max);

export const useCart = create<CartState>((set, get) => ({
  items: load(),
  add: (o, qtyKg = 1) => {
    const qty = clampQty(qtyKg, o.quantity);
    const items = get().items;
    const idx = items.findIndex((i) => i.offerId === o.id);
    if (idx >= 0) {
      const next = [...items];
      next[idx] = { ...next[idx], qtyKg: clampQty(next[idx].qtyKg + qty, next[idx].maxKg) };
      set({ items: next });
      return;
    }
    set({
      items: [
        ...items,
        {
          offerId: o.id,
          cropName: o.crop_name,
          emoji: o.emoji,
          unitPrice: o.unit_price,
          qtyKg: qty,
          maxKg: o.quantity,
          seller: o.seller || "",
          village: o.village,
          image: o.image,
        },
      ],
    });
  },
  setQty: (offerId, qtyKg) =>
    set({
      items: get().items.map((i) => (i.offerId === offerId ? { ...i, qtyKg: clampQty(qtyKg, i.maxKg) } : i)),
    }),
  remove: (offerId) => set({ items: get().items.filter((i) => i.offerId !== offerId) }),
  clear: () => set({ items: [] }),
}));

// Persistance locale du panier (restauré après rechargement / PWA offline).
useCart.subscribe((state) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ items: state.items }));
  } catch {
    /* stockage plein ou indisponible */
  }
});