import { useRef, type RefObject } from "react";
import { TRANSPORTS, type CourierDossier } from "../types";

/** Lit et retailler une photo (JPEG ~0,72, largeur max = max) pour un stockage léger.
 *  Décodage direct à la taille cible (createImageBitmap) pour éviter le plantage
 *  par manque de mémoire sur téléphones avec photos de plusieurs Mo. */
export function pickPhoto(file: File | undefined, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("Aucun fichier"));

    function encode(bitmap: ImageBitmap | HTMLImageElement, w: number, h: number) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas indisponible"));
        ctx.drawImage(bitmap, 0, 0, w, h);
        if (typeof (bitmap as ImageBitmap).close === "function") (bitmap as ImageBitmap).close();
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      } catch (e: any) {
        reject(new Error("Photo trop lourde pour cet appareil — choisis-en une plus légère (galerie)."));
      }
    }

    if (typeof createImageBitmap === "function" && "createImageBitmap" in window) {
      createImageBitmap(file, { resizeWidth: max, resizeHeight: max, resizeQuality: "high" })
        .then((bm) => {
          const scale = Math.min(1, max / Math.max(bm.width, bm.height));
          const w = Math.max(1, Math.round(bm.width * scale));
          const h = Math.max(1, Math.round(bm.height * scale));
          encode(bm, w, h);
        })
        .catch(() => legacyPath(file, max, resolve, reject));
    } else {
      legacyPath(file, max, resolve, reject);
    }
  });
}

function legacyPath(
  file: File,
  max: number,
  resolve: (v: string) => void,
  reject: (e: Error) => void
) {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => reject(new Error("Image illisible — essaie une autre photo"));
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas indisponible"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        reject(new Error("Photo trop lourde pour cet appareil — choisis-en une plus légère (galerie)."));
      }
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}

type Props = {
  value: CourierDossier;
  onChange: (d: CourierDossier) => void;
};

/** Photo de profil + pièce d'identité (recto/verso) exigées du livreur.
 *  Les photos de la pièce sont stockées sur nos serveurs — jamais montrées
 *  aux clients, réservées à Koodo en cas de litige. */
export default function CourierDossierFields({ value, onChange }: Props) {
  const selfieRef = useRef<HTMLInputElement>(null);
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  async function setPhoto(file: File | undefined, field: "selfie" | "id_front" | "id_back") {
    if (!file) return;
    try {
      const dataUrl = await pickPhoto(file, field === "selfie" ? 700 : 1100);
      onChange({ ...value, [field]: dataUrl });
    } catch (err: any) {
      alert(
        (err?.message || "Photo impossible — réessaie") +
          " Tu peux choisir une photo déjà prise (galerie) au lieu de la prendre à la seconde."
      );
    }
  }

  function photoBox(field: "selfie" | "id_front" | "id_back", label: string, ref: RefObject<HTMLInputElement>, sub: string) {
    const src = value[field];
    return (
      <div className="photo-box">
        <input ref={ref} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setPhoto(e.target.files?.[0], field)} />
        <button type="button" className="photo-thumb" onClick={() => ref.current?.click()}>
          {src ? <img src={src} alt={label} /> : <span>📷</span>}
        </button>
        <small>{label}</small>
        <em>{sub}</em>
      </div>
    );
  }

  return (
    <div>
      <div className="field">
        <label>Localité d'exercice *</label>
        <input value={value.locality || ""} onChange={(e) => onChange({ ...value, locality: e.target.value })} placeholder="Ex : Karpala, Ouagadougou" />
      </div>
      <div className="field">
        <label>Moyen de déplacement *</label>
        <select value={value.transport || ""} onChange={(e) => onChange({ ...value, transport: e.target.value })}>
          <option value="">— Choisis —</option>
          {TRANSPORTS.map((t) => <option key={t.label} value={t.label}>{t.emoji} {t.label}</option>)}
        </select>
      </div>
      <p className="section-label" style={{ fontSize: 11 }}>Ta photo + ta pièce d'identité *</p>
      <div className="photo-row">
        {photoBox("selfie", "Ta photo récente", selfieRef, "visible par vendeur/acheteur")}
      </div>
      <div className="photo-row">
        {photoBox("id_front", "CNI recto", frontRef, "privée — Koodo")}
        {photoBox("id_back", "CNI verso", backRef, "privée — Koodo")}
      </div>
      <p style={{ fontSize: 11, color: "var(--muted2)", margin: "6px 0 0" }}>
        Les photos de ta pièce d'identité sont stockées sur les serveurs Koodo, réservées à l'équipe en cas de
        malentendu. Elles ne sont jamais montrées aux clients — seule ta photo et ton nom circulent.
      </p>
    </div>
  );
}