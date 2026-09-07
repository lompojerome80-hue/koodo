import { create } from "zustand";
import type { User, Offer, Crop, AppNotification } from "./types";
import type { Lang } from "./i18n";
import { LANG_KEY } from "./i18n";

interface AppState {
  user: User | null;
  token: string | null;
  online: boolean;
  lang: Lang;
  offers: Offer[];
  myOffers: Offer[];
  crops: Crop[];
  pendingSync: number;
  selectedCrop: string;
  dbMode: "demo" | "firebase";
  geo: GeoState | null;
  geoTrying: boolean;
  notifications: AppNotification[];
  unseen: number;
  tutorial: boolean;
  setUser: (user: User | null) => void;
  setToken: (t: string | null) => void;
  setOnline: (v: boolean) => void;
  setLang: (l: Lang) => void;
  setOffers: (o: Offer[]) => void;
  setMyOffers: (o: Offer[]) => void;
  setCrops: (c: Crop[]) => void;
  setPendingSync: (n: number) => void;
  setSelectedCrop: (c: string) => void;
  setDbMode: (m: "demo" | "firebase") => void;
  setGeo: (g: GeoState | null) => void;
  setGeoTrying: (v: boolean) => void;
  setNotifications: (n: AppNotification[]) => void;
  setUnseen: (n: number) => void;
  setTutorial: (v: boolean) => void;
}

export interface GeoState {
  lat: number;
  lng: number;
  label: string;
  ts: number;
}

export const useApp = create<AppState>((set) => ({
  user: null,
  token: localStorage.getItem("koodo_token"),
  online: navigator.onLine,
  lang: (localStorage.getItem(LANG_KEY) as Lang) || "fr",
  offers: [],
  myOffers: [],
  crops: [],
  pendingSync: 0,
  selectedCrop: "mais",
  dbMode: "demo",
  geo: null,
  geoTrying: false,
  notifications: [],
  unseen: 0,
  tutorial: false,
  setUser: (user) => set({ user }),
  setToken: (token) => set({ token }),
  setOnline: (online) => set({ online }),
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {}
    set({ lang });
  },
  setOffers: (offers) => set({ offers }),
  setMyOffers: (myOffers) => set({ myOffers }),
  setCrops: (crops) => set({ crops }),
  setPendingSync: (pendingSync) => set({ pendingSync }),
  setSelectedCrop: (selectedCrop) => set({ selectedCrop }),
  setDbMode: (dbMode) => set({ dbMode }),
  setGeo: (geo) => set({ geo }),
  setGeoTrying: (geoTrying) => set({ geoTrying }),
  setNotifications: (notifications) =>
    set({ notifications, unseen: notifications.filter((x) => !x.seen).length }),
  setUnseen: (unseen) => set({ unseen }),
  setTutorial: (tutorial) => set({ tutorial }),
}));