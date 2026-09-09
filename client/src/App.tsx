import { useEffect, useRef } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useApp } from "./store";
import { useConnectivity } from "./hooks/useConnectivity";
import { useToast } from "./hooks/useToast";
import { flushOfflineQueue } from "./sync";
import { offline } from "./offline";
import Shell from "./components/Shell";
import PricesScreen from "./screens/PricesScreen";
import SellScreen from "./screens/SellScreen";
import MyPurchasesScreen from "./screens/MyPurchasesScreen";
import MarketScreen from "./screens/MarketScreen";
import AccountScreen from "./screens/AccountScreen";
import ThreadScreen from "./screens/ThreadScreen";
import PayScreen from "./screens/PayScreen";
import CartScreen from "./screens/CartScreen";
import ConseilScreen from "./screens/ConseilScreen";
import ReceiptScreen from "./screens/ReceiptScreen";
import AuthScreen from "./screens/AuthScreen";
import CourierScreen from "./screens/CourierScreen";
import AdminScreen from "./screens/AdminScreen";
import HelpScreen from "./screens/HelpScreen";
import ToastBox from "./components/ToastBox";
import TutorialOverlay, { TUTORIAL_KEY, clearTutorialPending } from "./components/TutorialOverlay";
import { data, dbMode, onUserChange } from "./data";
import type { User } from "./types";

export default function App() {
  const user = useApp((s) => s.user);
  const token = useApp((s) => s.token);
  const setUser = useApp((s) => s.setUser);
  const setCrops = useApp((s) => s.setCrops);
  const setOffers = useApp((s) => s.setOffers);
  const setMyOffers = useApp((s) => s.setMyOffers);
  const setPendingSync = useApp((s) => s.setPendingSync);
  const setDbMode = useApp((s) => s.setDbMode);
  const setTutorial = useApp((s) => s.setTutorial);
  const tutorial = useApp((s) => s.tutorial);
  const online = useApp((s) => s.online);
  const showToast = useToast((s) => s.show);
  const unsubRef = useRef<(() => void) | null>(null);
  useConnectivity();

  async function reload(who?: User | null) {
    const target = who === undefined ? useApp.getState().user : who;
    if (!target) return;
    try {
      setOffers(await data.listMarketOffers());
    } catch { /* offline */ }
    if (target.role === "producer") {
      try {
        setMyOffers(await data.listMyOffers());
      } catch { /* offline */ }
    }
  }

  // Bootstrap : base de données, restauration de session, données de marché
  useEffect(() => {
    let cancelled = false;
    setDbMode(dbMode);

    void (async () => {
      const crops = await data.getCrops().catch(() => []);
      if (!cancelled && crops.length) setCrops(crops);

      const restored = await data.restoreSession().catch(() => null);
      if (cancelled) return;
      if (restored) setUser(restored);

      if (dbMode === "demo" && token) {
        void reload(restored ?? undefined);
      }
    })();

    // Firebase : synchronise la session (connexion ailleurs, déconnexion, refresh)
    unsubRef.current = onUserChange((u: { uid: string } | null) => {
      if (!u) {
        setUser(null);
        setOffers([]);
        setMyOffers([]);
        return;
      }
      void (async () => {
        const me = await data.refreshUser(u.uid).catch(() => null);
        if (me) {
          setUser(me);
          void reload(me);
        }
      })();
    });

    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, []);

  // Après connexion / restauration : charger le marché pour l'utilisateur
  useEffect(() => {
    if (user?.id) void reload(user);
  }, [user?.id]);

  // Premier compte créé : montrer le tutoriel de bienvenue une seule fois.
  useEffect(() => {
    if (!user?.id) return;
    try {
      if (localStorage.getItem(TUTORIAL_KEY) === "1") {
        clearTutorialPending();
        setTutorial(true);
      }
    } catch {}
  }, [user?.id, setTutorial]);

  // Revenu en ligne : vider la file de sync (mode démo) puis rafraîchir
  useEffect(() => {
    if (!online) return;
    (async () => {
      if (dbMode === "demo") {
        const n = await flushOfflineQueue();
        if (n > 0) {
          showToast(n === 1 ? "Annonce synchronisée ✓" : `${n} annonces synchronisées ✓`);
          const pending = await offline.listQueue();
          setPendingSync(pending.length);
        }
      }
      void reload();
    })();
  }, [online]);

  // File d'envoi : retentatives automatiques (toutes les 15 s) + au retour au
  // premier plan. Une annonce mise « en file » (réseau lent, serveur endormi)
  // part toute seule dès que le serveur répond — sans action de l'utilisateur.
  useEffect(() => {
    if (dbMode !== "demo" || !user?.id) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || !useApp.getState().online) return;
      try {
        const n = await flushOfflineQueue();
        if (n === 0) return;
        const pending = await offline.listQueue();
        setPendingSync(pending.length);
        const u = useApp.getState().user;
        if (u?.role === "producer") {
          setMyOffers(await data.listMyOffers());
        }
        useToast.getState().show(n === 1 ? "Annonce synchronisée ✓" : `${n} annonces synchronisées ✓`);
      } catch {}
    };
    void tick();
    const iv = setInterval(() => void tick(), 15000);
    const vis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [dbMode, user?.id, setPendingSync, setMyOffers]);

  return (
    <>
      {!user ? (
        <AuthScreen />
      ) : (
        <Shell>
          {user?.role === "courier" ? (
            <Routes>
              <Route path="/" element={<Navigate to="/livraisons" replace />} />
              <Route path="/livraisons" element={<CourierScreen />} />
              <Route path="/compte" element={<AccountScreen />} />
              <Route path="/aide" element={<HelpScreen />} />
              <Route path="*" element={<Navigate to="/livraisons" replace />} />
            </Routes>
          ) : user?.role === "admin" ? (
            <Routes>
              <Route path="/" element={<Navigate to="/admin" replace />} />
              <Route path="/admin" element={<AdminScreen />} />
              <Route path="/compte" element={<AccountScreen />} />
              <Route path="/aide" element={<HelpScreen />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<PricesScreen />} />
              <Route path="/vendre" element={<SellScreen />} />
              <Route path="/achats" element={<MyPurchasesScreen />} />
              <Route path="/marche" element={<MarketScreen />} />
              <Route path="/compte" element={<AccountScreen />} />
              <Route path="/aide" element={<HelpScreen />} />
              <Route path="/message/:offerId" element={<ThreadScreen />} />
              <Route path="/payer/:offerId" element={<PayScreen />} />
              <Route path="/conseil" element={<ConseilScreen />} />
              <Route path="/panier" element={<CartScreen />} />
              <Route path="/livraisons" element={<CourierScreen />} />
              <Route path="/recu/:txId" element={<ReceiptScreen />} />
            </Routes>
          )}
        </Shell>
      )}
      {user && tutorial && <TutorialOverlay />}
      <ToastBox />
    </>
  );
}