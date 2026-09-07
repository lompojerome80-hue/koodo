# AGENTS.md

Instructions for AI coding agents working on this repository.

## Project layout

- Monorepo npm workspaces: `server/` (Express + better-sqlite3) and `client/` (React 18 + TypeScript + Vite PWA).
- Shared scripts live in the root `package.json`.
- There is no linter configured; the verification commands are:

```bash
npm run build                  # Vite production build of the client
npx tsc --noEmit -p client     # client type checking (must pass)
npm run test:server            # node:test server DB tests
```

## Architecture client (important)

The client talks to a **single data facade** `client/src/data.ts` that switches backend automatically:

- **`firebase`** when `client/.env` has `VITE_FIREBASE_*` (see `client/.env.example`) — uses Firebase Auth + Firestore, with offline persistence and realtime prices (`subscribePrices`).
- **`demo`** (default, no env vars) — uses the Express API + IndexedDB offline queue.

Rules of thumb:
- Screens import from `./data` (or `../data`), NEVER directly from `./api` or firebase modules.
- The repo contract is `client/src/db/types.ts` (`DataBackend` interface). Add a method → implement it in BOTH `client/src/db/demo.ts` and `client/src/db/firestore.ts`.
- `client/src/db/seed.ts` is the local mirror (crops/markets/prices) used to auto-seed Firestore when collections are empty.
- Payments: `client/src/payments/providers.ts` (sandbox `simulatePay`); real provider integration is documented there.
- Firestore security rules live at project root: `firestore.rules` (keep in sync with server model changes).

## Conventions

- `server/` is plain ESM (`"type": "module"`). Routes are Express Routers in `server/src/routes/*.routes.js`.
- SQLite via `better-sqlite3` (sync API). Schema in `server/src/db.js`; DB file at `server/data/koodo.db` (gitignored).
- Demo auth: JWT in `localStorage("koodo_token")`, token sent via `Bearer` (see `client/src/api.ts`).
- UI text is French. Currency is F CFA. Locale `fr-FR` for `toLocaleString`.
- `npm run dev` needs Node 20+; on this machine Node is at `C:\Users\lompo\tools\nodejs\` (not on PATH).

## Gotchas

- The server serves the built client from `client/dist` in production; SPA fallback uses `fs.existsSync`.
- PWA manifest + service worker are generated at build time by `vite-plugin-pwa` — do not hand-edit `client/dist/sw.js`.
- `client/src/db/firestore.ts` uses lazy getters (`dbc()`, `authc()`) so importing it in demo mode never throws.
- In Firebase mode the offline queue / `pendingSync` UI is inactive (Firestore persistence handles offline natively).