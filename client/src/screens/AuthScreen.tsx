import { useState } from "react";
import { useApp } from "../store";
import { useToast } from "../hooks/useToast";
import { data, dbMode } from "../data";
import { whatOtpRequest, whatOtpVerify, whatOtpRegister, normalizePhone } from "../auth/whatsapp";
import CourierDossierFields from "../components/CourierDossierFields";
import { markTutorialPending } from "../components/TutorialOverlay";
import type { Role, CourierDossier } from "../types";

/** Exigence du compte : mot de passe fort (8+, majuscule, minuscule, chiffre). */
function passwordIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 8) issues.push("8 caractères minimum");
  if (!/[A-Z]/.test(pw)) issues.push("une lettre majuscule");
  if (!/[a-z]/.test(pw)) issues.push("une lettre minuscule");
  if (!/[0-9]/.test(pw)) issues.push("un chiffre");
  return issues;
}

function dossierComplete(d: CourierDossier): boolean {
  return !!(d.locality && d.transport && d.selfie && d.id_front && d.id_back);
}

export default function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [step, setStep] = useState<"main" | "otp" | "otp-profile" | "google">("main");
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    password: "",
    role: "producer" as Role,
    region: "Ouagadougou",
    village: "",
  });
  const [dossier, setDossier] = useState<CourierDossier>({});
  const [otp, setOtp] = useState<{
    phone: string;
    devCode: string | null;
    sent: boolean;
    code: string;
    otpToken: string;
    otpPhone: string;
  }>({ phone: "", devCode: null, sent: false, code: "", otpToken: "", otpPhone: "" });
  const [gDraft, setGDraft] = useState<{ name: string; phone: string; draftToken?: string }>({ name: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const setUser = useApp((s) => s.setUser);
  const showToast = useToast((s) => s.show);

  const isFb = dbMode === "firebase";
  const busy = action !== null;
  const pwIssues = mode === "register" ? passwordIssues(form.password) : [];

  function resetError() {
    setError(null);
  }

  const courierSubmit = (base: CourierDossier): CourierDossier | null => {
    if (form.role !== "courier") return {};
    if (!dossierComplete(dossier)) {
      setError("Compte livreur : complète localité, moyen de déplacement, ta photo et ta pièce d'identité (recto + verso).");
      return null;
    }
    return { ...dossier, ...base };
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAction("password");
    try {
      if (mode === "register") {
        if (!form.fullName || !form.phone || !form.password) throw new Error("Remplis tous les champs obligatoires");
        if (pwIssues.length) throw new Error(`Mot de passe trop faible : ${pwIssues[0]}`);
        const docs = courierSubmit({});
        if (!docs) throw new Error(error || "Dossier incomplet");
        const user = await data.register({
          fullName: form.fullName,
          phone: form.phone,
          password: form.password,
          role: form.role,
          region: form.region,
          village: form.village,
          ...docs,
        });
        setUser(user);
        markTutorialPending();
        showToast("Compte créé — bienvenue sur Koodo ✓");
      } else {
        if (!form.phone || !form.password) throw new Error("Téléphone et mot de passe requis");
        const user = await data.login(form.phone, form.password);
        setUser(user);
        showToast("Connexion réussie ✓");
      }
    } catch (err: any) {
      setError(err.code === "auth/invalid-credential" ? "Identifiants incorrects" : err.message || "Une erreur est survenue");
    } finally {
      setAction(null);
    }
  }

  async function startWhatsApp() {
    resetError();
    setStep("otp");
    setOtp((o) => ({ ...o, phone: form.phone }));
  }

  async function sendOtp() {
    resetError();
    if (normalizePhone(otp.phone).length < 8) {
      setError("Entre ton numéro de téléphone");
      return;
    }
    setAction("otp-send");
    try {
      const r = await whatOtpRequest(otp.phone);
      setOtp((o) => ({ ...o, sent: true, devCode: r.devCode || null }));
      showToast(r.message);
    } catch (err: any) {
      setError(err.message || "Envoi impossible");
    } finally {
      setAction(null);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    resetError();
    setAction("otp-verify");
    try {
      const r = await whatOtpVerify(otp.phone, otp.code);
      if (r.existing && r.user) {
        setUser(r.user);
        showToast("Connexion avec WhatsApp ✓");
      } else {
        setOtp((o) => ({ ...o, otpToken: r.otpToken || "", otpPhone: normalizePhone(otp.phone) }));
        setStep("otp-profile");
      }
    } catch (err: any) {
      setError(err.message || "Code invalide");
    } finally {
      setAction(null);
    }
  }

  async function finishOtpRegister(e: React.FormEvent) {
    e.preventDefault();
    resetError();
    const docs = courierSubmit({});
    if (!docs) return;
    setAction("register");
    try {
      const user = await whatOtpRegister({
        otpToken: otp.otpToken,
        fullName: form.fullName,
        role: form.role,
        region: form.region || undefined,
        village: form.village || undefined,
        ...docs,
      });
      setUser(user);
      markTutorialPending();
      showToast("Compte WhatsApp créé ✓");
    } catch (err: any) {
      setError(err.message || "Inscription impossible");
    } finally {
      setAction(null);
    }
  }

  async function startGoogle() {
    resetError();
    setAction("google");
    try {
      const r = await data.googleLogin();
      if (r.user) {
        setUser(r.user);
        showToast("Connecté avec Google ✓");
      } else {
        setGDraft({ name: r.draftName, phone: r.draftPhone, draftToken: r.draftToken });
        setForm((f) => ({ ...f, fullName: f.fullName || r.draftName, phone: f.phone || r.draftPhone }));
        setStep("google");
      }
    } catch (err: any) {
      setError(err.code === "auth/popup-closed-by-user" ? "Fenêtre Google fermée" : err.message || "Connexion Google impossible");
    } finally {
      setAction(null);
    }
  }

  async function finishGoogle(e: React.FormEvent) {
    e.preventDefault();
    resetError();
    const docs = courierSubmit({});
    if (!docs) return;
    setAction("register");
    try {
      const user = await data.completeGoogleProfile({
        name: form.fullName,
        phone: form.phone || undefined,
        role: form.role,
        region: form.region || undefined,
        village: form.village || undefined,
        draftToken: gDraft.draftToken,
        ...docs,
      });
      setUser(user);
      markTutorialPending();
      showToast("Compte Google créé ✓");
    } catch (err: any) {
      setError(err.message || "Inscription impossible");
    } finally {
      setAction(null);
    }
  }

  const googleLabel = isFb
    ? mode === "register" ? "Créer mon compte avec Google" : "Se connecter avec Google"
    : mode === "register" ? "Créer mon compte avec Google (démo)" : "Se connecter avec Google (démo)";

  return (
    <div className="app-shell" style={{ justifyContent: "center" }}>
      <div className="form-panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div className="logo" style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(135deg, var(--orange), #F6A83C)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 22V10M12 10c0-3 2-5 5-5M12 10C12 7 10 5 7 5" stroke="#1B4332" strokeWidth="2.2" strokeLinecap="round"/></svg>
            </div>
            <h1 style={{ margin: 0 }}>Koodo</h1>
          </div>
          <span className={`pill ${isFb ? "open" : "pending"}`} style={{ marginTop: 0 }}>
            {isFb ? "Firebase" : "Mode démo"}
          </span>
        </div>
        <p className="sub">Le marché à portée de main — prix du marché, ventes directes et paiements mobiles, même sans réseau.</p>

        {error && <div className="error-box">{error}</div>}

        {step === "main" && (
          <>
            <div className="chips" style={{ marginBottom: 16 }}>
              <button className={`chip ${mode === "login" ? "active" : ""}`} onClick={() => { setMode("login"); resetError(); }}>Connexion</button>
              <button className={`chip ${mode === "register" ? "active" : ""}`} onClick={() => { setMode("register"); resetError(); }}>Inscription</button>
            </div>

            {/* Google : méthode de création de compte principale */}
            <button className="btn-google btn-google-primary" onClick={startGoogle} disabled={busy} style={{ opacity: busy ? .7 : 1 }}>
              <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.4 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.4 6.1 29.4 4 24 4 15.9 4 8.9 8.5 5.2 15.2z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C36.9 40.5 44 35.3 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
              {action === "google" ? "Connexion à Google…" : googleLabel}
            </button>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0", textAlign: "center" }}>
              {isFb ? "Compte créé en quelques secondes — sans mot de passe à retenir." : "Démo : compte Google simulé (Firebase requis en production)."}
            </p>

            <div className="auth-divider"><span>ou par téléphone</span></div>

            <form className="form-card" onSubmit={submit}>
              {mode === "register" && (
                <>
                  <div className="field">
                    <label>Nom complet *</label>
                    <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Ex : Issouf Ouattara" />
                  </div>
                  <div className="field">
                    <label>Je suis… *</label>
                    <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                      <option value="producer">🌾 Vendeur / producteur — je vends ma récolte</option>
                      <option value="buyer">🛒 Acheteur — j'achète aux producteurs</option>
                      <option value="courier">🛵 Livreur — je livre les courses commerçantes</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Village / quartier</label>
                    <input value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} placeholder="Ex : Gbêlêkro" />
                  </div>
                </>
              )}
              <div className="field">
                <label>Téléphone *</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Ex : +226 70 01 00 00 01" inputMode="tel" />
              </div>
              {mode === "register" && isFb && (
                <div className="field">
                  <label>E-mail (optionnel)</label>
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ex : nom@mail.com" inputMode="email" />
                </div>
              )}
              <div className="field">
                <label>Mot de passe *</label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
              </div>
              {mode === "register" && form.password.length > 0 && (
                <p className={`pw-hint ${pwIssues.length ? "pw-hint-bad" : "pw-hint-ok"}`}>
                  {pwIssues.length ? `Mot de passe à renforcer : ${pwIssues.join(", ")}.` : "Mot de passe fort ✓"}
                </p>
              )}
              {mode === "register" && form.role === "courier" && <CourierDossierFields value={dossier} onChange={setDossier} />}
              <button type="submit" className="btn btn-primary" disabled={busy} style={{ opacity: busy ? .7 : 1 }}>
                {action === "password" ? "Un instant…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
              </button>
            </form>

            <button className="btn-whatsapp" style={{ width: "100%", opacity: busy ? .7 : 1 }} onClick={startWhatsApp} disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-1 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.9-1.7-2.2-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1 2.9 1.2 3.1c.2.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3z"/><path d="M12 2a10 10 0 00-8.6 15l-1.3 4.7 4.9-1.3A10 10 0 1012 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8.2 8.2 0 1112 20.2z"/></svg>
              {mode === "register" ? "S'inscrire avec WhatsApp" : "Se connecter avec WhatsApp"}
            </button>

            {dbMode === "demo" && (
              <p className="switch-line">
                Démo : vendeur <a onClick={() => setForm({ ...form, phone: "+2260701000001", password: "password123" })}>+2260701000001</a>
                {" · "}acheteur <a onClick={() => setForm({ ...form, phone: "+2260701000003", password: "password123" })}>+2260701000003</a>
                {" · "}livreur <a onClick={() => setForm({ ...form, phone: "+2260701000005", password: "password123" })}>+2260701000005</a>
              </p>
            )}
            {isFb && (
              <p className="switch-line" style={{ fontSize: 11 }}>
                Connecté à Firebase (Firestore + Auth). Google et WhatsApp sont actifs.
              </p>
            )}
          </>
        )}

        {step === "otp" && (
          <div className="form-card">
            <h3 style={{ margin: "0 0 2px" }} className="font-display">Connexion par WhatsApp</h3>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
              Reçois un code par WhatsApp pour te connecter ou créer ton compte.
            </p>

            <div className="field">
              <label>Téléphone *</label>
              <input value={otp.phone} onChange={(e) => setOtp({ ...otp, phone: e.target.value })} placeholder="Ex : +226 70 01 00 00 01" inputMode="tel" disabled={otp.sent} />
            </div>

            {!otp.sent ? (
              <button className="btn btn-green" onClick={sendOtp} disabled={busy} style={{ width: "100%", opacity: busy ? .7 : 1 }}>
                {action === "otp-send" ? "Envoi…" : "Recevoir le code par WhatsApp"}
              </button>
            ) : (
              <>
                {otp.devCode && (
                  <div className="dev-code">
                    <b>Code reçu (sandbox)</b>
                    <span className="font-mono" style={{ fontSize: 22, letterSpacing: 4 }}>{otp.devCode}</span>
                    <small>En production, ce code arrive par message WhatsApp.</small>
                  </div>
                )}
                <form onSubmit={verifyOtp}>
                  <div className="field">
                    <label>Code à 6 chiffres *</label>
                    <input value={otp.code} onChange={(e) => setOtp({ ...otp, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="000000" inputMode="numeric" style={{ letterSpacing: 6, textAlign: "center" }} />
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={busy || otp.code.length < 6} style={{ width: "100%", opacity: busy ? .7 : 1 }}>
                    {action === "otp-verify" ? "Vérification…" : "Vérifier et continuer"}
                  </button>
                </form>
                <button className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => { setOtp({ phone: otp.phone, devCode: null, sent: false, code: "", otpToken: "", otpPhone: "" }); resetError(); }}>
                  Renvoyer un code
                </button>
              </>
            )}

            <button className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => { setStep("main"); resetError(); }}>
              ← Retour
            </button>
          </div>
        )}

        {step === "otp-profile" && (
          <form className="form-card" onSubmit={finishOtpRegister}>
            <h3 style={{ margin: "0 0 2px" }} className="font-display">Presque fini 🎉</h3>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
              Numéro vérifié : <b className="font-mono">{otp.otpPhone}</b>. Précise ton profil pour créer ton compte.
            </p>
            <div className="field">
              <label>Nom complet *</label>
              <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Ex : Issouf Ouattara" />
            </div>
            <div className="field">
              <label>Je suis… *</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="producer">🌾 Vendeur / producteur — je vends ma récolte</option>
                <option value="buyer">🛒 Acheteur — j'achète aux producteurs</option>
                <option value="courier">🛵 Livreur — je livre les courses commerçantes</option>
              </select>
            </div>
            <div className="field">
              <label>Village / quartier</label>
              <input value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} placeholder="Ex : Gbêlêkro" />
            </div>
            {form.role === "courier" && <CourierDossierFields value={dossier} onChange={setDossier} />}
            <button type="submit" className="btn btn-primary" disabled={busy || !form.fullName} style={{ width: "100%", opacity: busy ? .7 : 1 }}>
              {action === "register" ? "Création…" : "Créer mon compte"}
            </button>
            <button type="button" className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setStep("main")}>
              ← Retour
            </button>
          </form>
        )}

        {step === "google" && (
          <form className="form-card" onSubmit={finishGoogle}>
            <h3 style={{ margin: "0 0 2px" }} className="font-display">Bienvenue via Google 🙌</h3>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
              {isFb ? `Ton compte Google est reconnu (${gDraft.name || form.email || "—"}). Précise ton profil.`
                : `Compte Google simulé (${gDraft.name || form.email || "Ibrahim Ouattara"}). Précise ton profil.`}
            </p>
            <div className="field">
              <label>Nom complet *</label>
              <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Ex : Issouf Ouattara" />
            </div>
            <div className="field">
              <label>Je suis… *</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="producer">🌾 Vendeur / producteur — je vends ma récolte</option>
                <option value="buyer">🛒 Acheteur — j'achète aux producteurs</option>
                <option value="courier">🛵 Livreur — je livre les courses commerçantes</option>
              </select>
            </div>
            <div className="field">
              <label>Village / quartier</label>
              <input value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} placeholder="Ex : Gbêlêkro" />
            </div>
            {form.role === "courier" && <CourierDossierFields value={dossier} onChange={setDossier} />}
            <button type="submit" className="btn btn-primary" disabled={busy || !form.fullName} style={{ width: "100%", opacity: busy ? .7 : 1 }}>
              {action === "register" ? "Création…" : "Créer mon compte"}
            </button>
            <button type="button" className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setStep("main")}>
              ← Retour
            </button>
          </form>
        )}
      </div>
    </div>
  );
}