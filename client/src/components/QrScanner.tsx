import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

/** Scanner plein écran : lit le QR du client (ou du vendeur) et renvoie le code.
 *  En cas de refus caméra ou d'échec, on ferme : la saisie manuelle reste possible. */
export default function QrScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const boxId = "koodo-qr-reader";
  const handled = useRef(false);

  useEffect(() => {
    let scanner: Html5Qrcode | null = null;
    let cancelled = false;
    const qr = new Html5Qrcode(boxId, { verbose: false });
    scanner = qr;
    qr.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (text) => {
        if (handled.current || cancelled) return;
        handled.current = true;
        const code = String(text || "").trim();
        qr.stop()
          .catch(() => {})
          .finally(() => {
            try { qr.clear(); } catch { /* d3 lib */
            }
            if (code) onResult(code);
            else onClose();
          });
      },
      () => {
        /* frame non détectée */
      }
    ).catch(() => {
      if (!cancelled) onClose();
    });

    return () => {
      cancelled = true;
      try { scanner?.stop().catch(() => {}); } catch { /* déjà arrêté */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="qr-overlay" onClick={onClose}>
      <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
        <b style={{ fontSize: 14 }}>📷 Scanne le code du client</b>
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 10px" }}>
          Cadre le QR code affiché par l'acheteur (ou le vendeur). Saisis le code à la main si la caméra ne s'ouvre pas.
        </p>
        <div id={boxId} style={{ minHeight: 220 }} />
        <button className="btn btn-ghost" style={{ marginTop: 10, width: "100%" }} onClick={onClose}>
          Fermer — saisir le code à la main
        </button>
      </div>
    </div>
  );
}