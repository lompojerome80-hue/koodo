import { useEffect, useRef } from "react";
import QRCode from "qrcode";

/** QR code affiché (canvas) — sert à matérialiser un code (livraison, récupération). */
export default function QrCode({ value, size = 150 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    let alive = true;
    QRCode.toCanvas(ref.current, value, { width: size, margin: 1, errorCorrectionLevel: "M" }).catch(() => {
      /* code illisible — pas critique */
    });
    return () => {
      alive = false;
    };
  }, [value, size]);
  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} />;
}