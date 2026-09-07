# Koodo — le marché à portée de main

Application de haut niveau pour les producteurs et acheteurs : **prix du marché en temps réel, vente directe avec paiements Mobile Money africains (Orange Money · MTN MoMo · Wave · Moov), messagerie et alertes prix — même hors ligne.**

## Architecture

```
sokoo-pwa/                       # dossier du projet (nom historique)
├── package.json                 # workspaces + scripts
├── firestore.rules              # règles de sécurité Firestore
├── scripts/seed-firebase.mjs    # seed Firestore (firebase-admin)
├── server/                      # API démo (Express + SQLite) — utilisé quand Firebase n'est pas configuré
│   ├── src/routes/*.routes.js   # auth, market, offers, messages, alerts, payments
│   └── test/                    # node:test
└── client/                      # PWA React 18 + TypeScript + Vite
    └── src/
        ├── data.ts              # façade : bascule automatique Firebase ⇄ démo
        ├── db/                  # contrat DataBackend + impléments demo/Firestore + seed miroir
        ├── firebase/            # config + Auth (e-mail dérivé du téléphone)
        ├── payments/            # providers Mobile Money + paiement sandbox
        ├── components/          # Shell, ToastBox
        └── screens/             # Auth, Prix, Vendre, Marché, Paiement, Reçu, Messages, Compte
```

## Deux modes de fonctionnement

| Mode | Quand ? | Base | Offline |
|------|---------|------|---------|
| **Démo** (défaut) | aucune variable `VITE_FIREBASE_*` | API Express + SQLite, file de sync IndexedDB | ✅ annonces mises en file puis synchronisées |
| **Firebase** | `client/.env` renseigné | Firestore + Firebase Auth | ✅ persistance locale native + prix temps réel |

Passer en Firebase : copier `client/.env.example` → `client/.env`, coller les clés de la console Firebase, activer **Authentication** (e-mail/mot de passe) et **Firestore**, déployer `firestore.rules`, puis `npm run seed:firebase`.

## Démarrer

```bash
# Prérequis : Node 20+ (sur cette machine : C:\Users\lompo\tools\nodejs)
npm install
npm run dev        # API (4000) + client (5173)
npm run build && npm start    # production → http://localhost:4000
```

## Comptes de démo (mode démo)

| Rôle | Téléphone | Mot de passe |
|------|-----------|--------------|
| 🌾 Vendeur | +2250701000001 | password123 |
| 🛒 Acheteur | +2250701000003 | password123 |
| 🛵 Livreur | +2250701000005 | password123 |

**Compte Google démo** : l'identité Google est simulée et reproductible (`Ibrahim Ouattara` / `ibrahim.ouattara.demo@gmail.com`, téléphone +2250701000097). En Firebase (`client/.env` renseigné), le vrai compte Google de l'utilisateur est utilisé.

## Comptes & dossier livreur

- **Création de compte par Google (méthode principale)** : bouton Google affiché en premier ; les connexions par téléphone (mot de passe) et WhatsApp restent disponibles sous le séparateur « ou par téléphone ». Tout compte créé par la voie « mot de passe » exige un **mot de passe fort** : 8 caractères minimum, une majuscule, une minuscule, un chiffre.
- **Dossier livreur obligatoire** : localité d'exercice, moyen de déplacement, **photo récente** (celle-ci est publique — montrée aux vendeurs/acheteurs) et **photos recto + verso de la pièce d'identité**, stockées sur les serveurs Koodo et **réservées à l'équipe en cas de litige** (jamais transmises aux clients).
- Le livreur **peut modifier** son dossier en tout temps dans « Mon dossier » (onglet Livraisons), mais **ne peut pas supprimer** ses photos de pièce : remplacement uniquement.
- Tant que le dossier est incomplet, le bouton « Accepter la course » reste désactivé (et le serveur renvoie 403 en renfort).
- À l'acceptation d'une course, **le vendeur et l'acheteur sont notifiés de l'identité publique du livreur** : nom, photo, moyen de déplacement, localité (jamais les photos de sa pièce d'identité).
- **Centre de notifications in-app** : cloche dans la barre supérieure avec badge de non lues. Notifications **persistantes** (créées au moment de l'événement — l'utilisateur les retrouve à sa connexion suivante) : « livreur trouvé » (vendeur + acheteur), « colis récupéré, en route » (acheteur), « course livrée » (vendeur). Chaque notification affiche la **photo + le nom du livreur** ; toute la navigation y est accessible (« Tout marquer lu »). En mode démo les notifications sont stockées côté serveur ; en mode Firebase elles vivent dans des événements de la course (`deliveries/{id}/events`), un compte n'accédant qu'aux cours auxquels il participe.

## Fonctionnalités

- **Comptes & rôles** : inscription **vendeur**, **acheteur** ou **livreur**, profils (région, village), code USSD personnel, JWT (démo) ou Firebase Auth.
- **Prix dynamiques en temps réel** : meilleur prix du jour par culture, comparaison par ville (prix, distance réelle, tendance 72 h) — abonnement temps réel Firestore (pulsation "en direct") ou rafraîchissement auto en démo. **Les prix sont proposés selon la localisation de la personne** : villes triées par distance depuis sa position (bouton « Afficher les prix près de chez moi », badge « PRÈS DE TOI »). Données réelles : **47 produits × 6 villes** (Abidjan, Bouaké, Korhogo, Man, San-Pédro, Yamoussoukro) dans `market-data.json`, partagées par le serveur, le seed Firestore et le repli hors ligne.
- **Prix communautaires** : chaque membre signale le prix observé sur sa ville (« + Signaler ce prix ») — moyenne glissante, min/max suivis, badge « COMMUNAUTÉ », synchronisation instantanée (POST `/api/market/report`, transaction Firestore).
- **Vente directe** : publication d'annonces avec géolocalisation, marquer comme vendue, file hors ligne en démo.
- **Panier & masse** : l'acheteur saisit la **masse (kg)** qu'il souhaite par produit, ajoute au panier, et **le total est recalculé automatiquement** selon les articles et les quantités. Validation en un seul paiement Mobile Money, avec **stock décrémenté côté serveur** à chaque achat (annonce clôturée si épuisée).
- **Livraison / expédition** : l'acheteur peut **envoyer sa position** (géolocalisation + précisions) au moment de l'achat ; elle est jointe au reçu pour que le vendeur organise la livraison.
- **Livraisons communautaires (`/livraisons`, rôle livreur)** : le vendeur crée une course (intitulé, colis, destination, prix proposé) et **un livreur proche est notifié**. Cycle complet : acceptation → **code de récupération** (le vendeur le lit au livreur pour prouver la prise en charge) → **code de livraison** (l'acheteur le donne au livreur à la remise, affiché sur son reçu). Le livreur **touche le prix complet** de la course à la remise ; **Koodo prélève 10 % de commission** sur chaque course, versée dans son **dû quotidien** — à régler chaque soir **avant 00H**, sinon le compte est **bloqué automatiquement** jusqu'au règlement (écran livraisons + Compte).
- **Paiements Mobile Money** : Orange Money, MTN MoMo, Wave, Moov — choix de l'opérateur, frais calculés, numéro, **reçu avec référence**, historique "Mes achats" et "Revenus". Deux modes pilotés par environnement : **sandbox** (défaut, aucune somme débitée) ou **réel via CinetPay** (`PAYMENTS_MODE=reel` + clés), avec initiation côté serveur (`POST /api/payments/charge`) et **confirmation par webhook** (les clés ne circulent jamais dans le client).
- **Messagerie** : discussions par annonce vendeur ⇄ acheteur, conversations dans Compte, **suppression d'un message** par son expéditeur (ou le propriétaire de l'annonce).
- **Alertes prix** : prix cible par culture, notification quand le marché l'atteint.
- **PWA** : installable, offline-first, NetworkFirst sur l'API, mode économie.

## API

```
POST /api/auth/register      POST /api/auth/login       GET  /api/auth/me
POST /api/auth/google/draft  POST /api/auth/google/register   PATCH /api/auth/me/courier
GET  /api/market/prices      GET  /api/market/crops     GET  /api/market/trend
POST /api/offers             GET  /api/offers           GET  /api/offers?mine=1
PATCH /api/offers/:id        POST /api/offers/sync   POST /api/offers/consume
GET  /api/messages/threads   GET  /api/messages/:offerId    POST /api/messages/:offerId
DELETE /api/messages/:offerId/:messageId
GET  /api/alerts             POST /api/alerts           DELETE /api/alerts/:id
POST /api/payments/charge    POST /api/payments/webhook
```

`POST /api/payments/charge` accepte un produit (`offerId`, `qtyKg`) ou un panier (`items: [{offerId, qtyKg}]`) plus une livraison (`delivery: {lat, lng, label, note}`).

## Cycle de livraison (livreur)

```
POST /api/deliveries                    vendeur crée la course (prix proposé)
GET  /api/deliveries/open?lat=&lng=     le livreur voit les courses proches
POST /api/deliveries/:id/accept         le livreur accepte
POST /api/deliveries/:id/pickup         code du vendeur  → colis récupéré (proof)
POST /api/deliveries/:id/complete       code de l'acheteur → livré → commission 10 %
GET  /api/deliveries/dues               dû du jour + dette en retard + état bloqué
POST /api/deliveries/dues/settle        règlement du dû → déblocage
GET  /api/deliveries/for-me             l'acheteur voit le code à donner au livreur
```

Blocage automatique : à **00H**, tout dû impayé des jours passés bloque le compte du livreur (code 403 sur accept/pickup/complete) tant qu'il n'a pas réglé. En démo, tester avec `POST /api/deliveries/__debug/force-due-block`.

Dossier requis avant d'accepter (403 sinon) : localité, moyen de déplacement, photo et pièce d'identité (recto + verso), via `PATCH /api/auth/me/courier`. Dès l'acceptation, l'API renvoie aux vendeur/acheteur uniquement le nom, la photo, le transport et la localité du livreur — jamais ses photos de pièce.

## Mise en production

Copier `server/.env.example` → `server/.env` puis renseigner :

| Variable | Rôle |
|----------|------|
| `JWT_SECRET` | **Impératif** en prod (longue chaîne aléatoire). Sans elle, avertissement au démarrage. |
| `CORS_ORIGIN` | Domaine autorisé (ex. `https://prix.koodo.ci`). Vide = aucune restriction. |
| `OTP_MODE=whatsapp` | Envoi OTP réel via API **Meta WhatsApp Business Cloud** (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, template validé). En mode `simulated` (défaut), le code est affiché à l'écran — **ne jamais déployer ainsi**. |
| `PAYMENTS_MODE=reel` | Initiation réelle **CinetPay** (`CINETPAY_TOKEN`, `CINETPAY_SITE_ID`) avec confirmation par `POST /api/payments/webhook`. |
| `PUBLIC_BASE_URL` | Base publique du webhook de paiement. |

Exigences de production : **HTTPS** (PWA, géolocalisation, paiements), `VITE_PAYMENT_API=server` dans `client/.env`, et validation réelle de la signature des webhooks (`verifyWebhookSignature` dans `server/src/payments/service.js`).

## Tests & vérifs

```bash
npm run test:server      # node:test (SQLite)
npx tsc --noEmit -p client
npm run build
```

## Sécurité des paiements : escrow & litiges

Chaque achat est maintenant mis en **escrow** côté serveur (colonne `order_status = 'escrow'`). L'acheteur peut :

- **Confirmer la réception** → les fonds sont libérés au vendeur.
- **Ouvrir un litige** → les fonds restent bloqués, visibles aux deux parties.

Flux : `checkout` → `POST /payments/register` (escrow) → `POST /payments/confirm` (libération) ou `POST /payments/dispute`. Le vendeur voit ses fonds en attente via `GET /payments/escrow` dans l'onglet Compte.

## Passerelle USSD (`#144#`)

Route `GET|POST /api/ussd` compatible avec les passerelles USSD (Arkesel, Africa's Talking, opérateurs CI). Le producteur compose `#144#`, saisit son code personnel, puis navigue :

1. Consulter les prix par culture
2. Publier une annonce (culture, quantité, prix)
3. Créer une alerte prix
4. Voir ses annonces

Test local :
```bash
curl "http://localhost:4000/api/ussd?sessionId=test1&input=&msisdn=2250701000001"
curl "http://localhost:4000/api/ussd?sessionId=test1&input=devcode123&msisdn=2250701000001"
curl "http://localhost:4000/api/ussd?sessionId=test1&input=1&msisdn=2250701000001"
```

## Assistant WhatsApp

`GET /api/whatsapp/webhook` — vérification du webhook Meta.
`POST /api/whatsapp/webhook` — messages entrants avec réponses automatiques (prix, aide…). En mode `WHATSAPP_TOKEN` absent, répond en mode simulé (testable sans compte WhatsApp).

## Conseil de plantation (agri-intel)

Écran `/conseil` : analyse automatique des 72 dernières heures. Affiche les cultures avec la plus forte hausse (opportunité de vente) et les baisses (reporte la vente). Lien depuis l'écran Prix (`💡 Conseil plantation`).

## Aide-mémoire API

| Route | Rôle |
|-------|------|
| `GET /api/health` | Santé du service |
| `POST /api/auth/signup` / `login` / `otp/verify` | Inscription, connexion, OTP |
| `GET /api/market/crops` | Liste des cultures |
| `GET /api/market/prices/:cropId` | Prix par marché |
| `GET|POST /api/offers` | Annonces marché / création |
| `POST /api/offers/:id/consume` | Décrémente le stock (post-achat) |
| `POST /api/messages` | Envoi de message |
| `GET /api/payments/charge` / `webhook` | Paiement Mobile Money + webhook CinetPay |
| `POST /api/payments/register` | Enregistre un achat (escrow) |
| `POST /api/payments/confirm` | Confirme la réception → libère les fonds |
| `POST /api/payments/dispute` | Litige (bloque les fonds) |
| `GET /api/payments/escrow` | Résumé vendeur (fonds en attente / libérés / litiges) |
| `GET|POST /api/ussd` | Assistant USSD texte |
| `GET|POST /api/whatsapp/webhook` | Assistant WhatsApp (intents texte) |
| `GET|POST /api/deliveries` | Livraisons communautaires (création + cycle livreur) |
| `GET /api/deliveries/dues` | Dû du livreur (solde, dette, blocage) |
| `GET|POST /api/notifications` | Centre de notifications in-app + marquage lu |

## Ensuite

- ~~Validation réelle de la signature des webhooks CinetPay~~ → `verifyWebhookSignature` prêt ; activer avec `CINETPAY_SECRET`.
- ~~Passerelle USSD (`#144#`)~~ → route `/api/ussd` livrée.
- Notifications push pour les alertes prix (Firebase Cloud Messaging). Les notifications de livraison sont **in-app persistantes** (cloche) — un vrai push FCM (bannière/écran verrouillé) reste à brancher.
- ~~Géolocalisation active pour le tri des marchés par distance réelle~~ → déjà implémenté (tri par `haversineKm`).