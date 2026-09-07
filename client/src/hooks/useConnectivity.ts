import { useEffect } from "react";
import { useApp } from "../store";

export function useConnectivity() {
  const setOnline = useApp((s) => s.setOnline);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [setOnline]);
}