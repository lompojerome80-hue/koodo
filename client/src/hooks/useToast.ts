import { create } from "zustand";

interface ToastState {
  message: string | null;
  show: (msg: string) => void;
  hide: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (msg) => {
    set({ message: msg });
    clearTimeout((useToast as any)._t);
    (useToast as any)._t = setTimeout(() => set({ message: null }), 2400);
  },
  hide: () => set({ message: null }),
}));