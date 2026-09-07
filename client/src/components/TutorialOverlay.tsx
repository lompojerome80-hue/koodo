import { useMemo, useState } from "react";
import { useApp } from "../store";
import { useToast } from "../hooks/useToast";

// Tutoriel automatique affiché à la création d'un compte (une seule fois par
// compte) : un parcours d'étapes adapté au rôle choisi. On peut le relire à
// tout moment depuis l'écran « Demander de l'aide ».
export const TUTORIAL_KEY = "koodo_tutorial_pending";

export function markTutorialPending() {
  try {
    localStorage.setItem(TUTORIAL_KEY, "1");
  } catch {}
}

export function clearTutorialPending() {
  try {
    localStorage.removeItem(TUTORIAL_KEY);
  } catch {}
}

function stepsFor(role?: string) {
  const common = {
    emoji: "💬",
    title: "Besoin d'aide ?",
    body: "Tu trouveras « Demander de l'aide » dans ton onglet Compte : écris ton problème, le service technique te répond directement dans l'app.",
  };
  if (role === "courier") {
    return [
      {
        emoji: "🛵",
        title: "Bienvenue, livreur !",
        body: "Koodo te met en relation avec les vendeurs qui cherchent un livreur près de chez toi.",
      },
      {
        emoji: "📋",
        title: "Ton dossier a été vérifié",
        body: "L'admin a confirmé ta pièce d'identité. La bannière de validation a disparu : tu peux accepter des courses.",
      },
      {
        emoji: "🧭",
        title: "Trouve des courses près de toi",
        body: "Dans l'onglet Livraisons, choisis une course, puis récupère le colis avec le code du vendeur et remets-le avec le code de l'acheteur.",
      },
      {
        emoji: "💰",
        title: "Règle tes commissions",
        body: "Garde 90 % de chaque course, règle ton dû chaque soir avant 00H dans Compte pour rester actif.",
      },
      common,
    ];
  }
  if (role === "producer") {
    return [
      {
        emoji: "🌾",
        title: "Bienvenue, producteur !",
        body: "Koodo t'aide à vendre ta récolte aux meilleurs prix du marché, même sans réseau.",
      },
      {
        emoji: "📊",
        title: "Consulte les prix du jour",
        body: "Dans Prix, retrouve le prix au kg de chaque culture dans les grandes villes. Déclare aussi le prix que tu observes.",
      },
      {
        emoji: "📢",
        title: "Publie ta récolte",
        body: "Dans Vendre, annonce ta quantité et ton prix. Les acheteurs te contactent directement dans Marché.",
      },
      {
        emoji: "💸",
        title: "Sois payé par Mobile Money",
        body: "Quand un client paie, l'argent est sécurisé (escrow) jusqu'à la confirmation de la livraison. Trouve ensuite un livreur dans Livraisons.",
      },
      common,
    ];
  }
  return [
    {
      emoji: "🛒",
      title: "Bienvenue, acheteur !",
      body: "Koodo te permet d'acheter directement aux producteurs, aux prix du marché, partout en Côte d'Ivoire.",
    },
    {
      emoji: "📊",
      title: "Compare les prix",
      body: "Dans Prix, choisis une culture pour voir les prix au kg dans les grandes villes et suivre la tendance.",
    },
    {
      emoji: "🛍️",
      title: "Achète dans le Marché",
      body: "Parcours les annonces des producteurs, négocie et commande. Ton paiement est sécurisé par escrow jusqu'à réception.",
    },
    {
      emoji: "🛵",
      title: "Suis la livraison",
      body: "Le produit est livré par un livreur Koodo. Confirme la réception pour libérer le paiement au producteur.",
    },
    common,
  ];
}

export default function TutorialOverlay() {
  const user = useApp((s) => s.user);
  const setTutorial = useApp((s) => s.setTutorial);
  const showToast = useToast((s) => s.show);
  const [index, setIndex] = useState(0);
  const steps = useMemo(() => stepsFor(user?.role), [user?.role]);
  const step = steps[Math.min(index, steps.length - 1)];

  function next() {
    if (index < steps.length - 1) {
      setIndex(index + 1);
    } else {
      clearTutorialPending();
      setTutorial(false);
      showToast("Vous savez l'essentiel. Bonne continuation sur Koodo ✓");
    }
  }

  function skip() {
    clearTutorialPending();
    setTutorial(false);
  }

  function back() {
    if (index > 0) setIndex(index - 1);
  }

  return (
    <div className="tutorial-overlay" role="dialog" aria-label="Tutoriel de bienvenue">
      <div className="tutorial-card" data-step={index}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="pill open">Tutoriel · {index + 1}/{steps.length}</span>
          <button className="btn btn-ghost btn-sm" onClick={skip}>Passer</button>
        </div>

        <div className="tutorial-step">
          <div className="icon" style={{ fontSize: 40 }}>{step.emoji}</div>
          <h2 className="font-display" style={{ margin: "8px 0 4px", fontSize: 20 }}>{step.title}</h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--muted)" }}>{step.body}</p>
        </div>

        <div className="tutorial-dots">
          {steps.map((_, i) => (
            <span key={i} className={`tutorial-dot ${i === index ? "active" : ""}`} />
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {index > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={back} style={{ flex: 1 }}>
              ← Retour
            </button>
          )}
          <button className="btn btn-primary" onClick={next} style={{ flex: 2 }}>
            {index < steps.length - 1 ? "Suivant" : "C'est parti !"}
          </button>
        </div>
      </div>
    </div>
  );
}