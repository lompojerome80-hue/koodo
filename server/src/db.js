import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, "koodo.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    full_name  TEXT NOT NULL,
    phone      TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'producer' CHECK (role IN ('producer','buyer','courier','admin')),
    region     TEXT,
    village    TEXT,
    avatar     TEXT,
    ussd_code  TEXT,
    verified   INTEGER NOT NULL DEFAULT 0,
    blocked    INTEGER NOT NULL DEFAULT 0,
    blocked_reason TEXT,
    auth_provider TEXT NOT NULL DEFAULT 'sms',
    google_uid TEXT,
    email      TEXT,
    locality   TEXT,
    transport  TEXT,
    selfie     TEXT,
    id_front   TEXT,
    id_back    TEXT,
    doc_status TEXT NOT NULL DEFAULT 'pending',
    doc_updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS markets (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    region  TEXT NOT NULL,
    lat     REAL,
    lng     REAL,
    is_open INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS crops (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'kg',
    emoji TEXT
  );

  CREATE TABLE IF NOT EXISTS prices (
    id         TEXT PRIMARY KEY,
    crop_id    TEXT NOT NULL REFERENCES crops(id),
    market_id  TEXT NOT NULL REFERENCES markets(id),
    min_price  REAL NOT NULL,
    max_price  REAL NOT NULL,
    avg_price  REAL NOT NULL,
    reporter   TEXT,
    source     TEXT NOT NULL DEFAULT 'reporter',
    report_count INTEGER NOT NULL DEFAULT 0,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    code       TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS offers (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    crop_id    TEXT NOT NULL REFERENCES crops(id),
    quantity   REAL NOT NULL,
    unit_price REAL NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sold','cancelled')),
    location_lat REAL,
    location_lng REAL,
    image      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    offer_id   TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    sender_id  TEXT NOT NULL REFERENCES users(id),
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    crop_id    TEXT NOT NULL REFERENCES crops(id),
    target_price REAL NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sync_queue (
    id         TEXT PRIMARY KEY,
    user_id    TEXT,
    op         TEXT NOT NULL,
    entity     TEXT NOT NULL,
    payload    TEXT NOT NULL,
    synced     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id         TEXT PRIMARY KEY,
    offer_id   TEXT NOT NULL REFERENCES offers(id),
    buyer_id   TEXT NOT NULL REFERENCES users(id),
    amount     REAL NOT NULL,
    fee        REAL NOT NULL DEFAULT 0,
    provider   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    reference  TEXT,
    qty_kg     REAL,
    location_lat REAL,
    location_lng REAL,
    delivery_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id           TEXT PRIMARY KEY,
    tx_ref       TEXT,
    title        TEXT NOT NULL,
    package      TEXT,
    seller_id    TEXT NOT NULL REFERENCES users(id),
    courier_id   TEXT REFERENCES users(id),
    seller_lat   REAL,
    seller_lng   REAL,
    seller_label TEXT,
    buyer_lat    REAL,
    buyer_lng    REAL,
    buyer_label  TEXT NOT NULL,
    buyer_phone  TEXT,
    price_fee    REAL NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','cancelled','accepted','picked_up','delivered','done')),
    pickup_code  TEXT,
    delivery_code TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    accepted_at  TEXT,
    picked_at    TEXT,
    delivered_at TEXT
  );

  CREATE TABLE IF NOT EXISTS courier_dues (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    courier_id TEXT NOT NULL REFERENCES users(id),
    due_date   TEXT NOT NULL,
    amount     REAL NOT NULL DEFAULT 0,
    paid       INTEGER NOT NULL DEFAULT 0,
    paid_at    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    actor_name  TEXT,
    actor_photo TEXT,
    offer_id    TEXT REFERENCES offers(id),
    delivery_id TEXT,
    seen        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Règlements du dû (Koodo). « receipt » = capture d'écran du paiement envoyée
  -- par le livreur ; si fournie, le règlement reste « pending » jusqu'à la
  -- confirmation de l'admin, sinon il est confirmé immédiatement (simulation démo).
  CREATE TABLE IF NOT EXISTS payments (
    id           TEXT PRIMARY KEY,
    courier_id   TEXT NOT NULL REFERENCES users(id),
    amount       REAL NOT NULL DEFAULT 0,
    receipt      TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    confirmed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_payments_courier ON payments (courier_id, status);

  -- Signalements de prix communautaires : chaque membre signale un prix observé ;
  -- un prix n'est publié qu'après 2 signalements CONCORDANTS (anti-fraude).
  CREATE TABLE IF NOT EXISTS price_reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    crop_id    TEXT NOT NULL REFERENCES crops(id),
    market_id  TEXT NOT NULL REFERENCES markets(id),
    price      REAL NOT NULL,
    user_id    TEXT NOT NULL,
    applied    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_price_reports_cm ON price_reports (crop_id, market_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, seen, created_at DESC);

  -- Aide / service technique : demandes de l'utilisateur (tickets) et réponses
  -- du service technique (messages avec rôle sender).
  CREATE TABLE IF NOT EXISTS support_threads (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject        TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
    last_message_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS support_messages (
    id         TEXT PRIMARY KEY,
    thread_id  TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('user','admin')),
    sender_id  TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads (user_id, last_message_at DESC);
  CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages (thread_id, created_at ASC);

  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, seen, created_at DESC);

  -- Signalements d'annonces (modération UGC — exigence Google Play) : un membre
  -- signale une annonce abusive/frauduleuse ; l'admin la retire ou la maintient.
  CREATE TABLE IF NOT EXISTS reports (
    id          TEXT PRIMARY KEY,
    offer_id    TEXT NOT NULL REFERENCES offers(id),
    reporter_id TEXT NOT NULL REFERENCES users(id),
    reason      TEXT NOT NULL,
    note        TEXT,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','handled','ignored')),
    handled_by  TEXT,
    handled_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (offer_id, reporter_id)
  );

  -- Blocage utilisateur : le contenu et les messages d'une partie bloquée ne
  -- doivent plus apparaître à l'autre. Directionnel (A bloque B n'implique pas
  -- B bloque A).
  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL REFERENCES users(id),
    blocked_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (blocker_id, blocked_id)
  );

  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_offer ON reports (offer_id);
  CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);
`);

// Migration : colonnes livraison / quantité / escrow des transactions (bases créées avant)
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN qty_kg REAL").run();
} catch {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN location_lat REAL").run();
} catch {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN location_lng REAL").run();
} catch {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN delivery_note TEXT").run();
} catch {}

// Migration : escrow / litiges des transactions
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN client_ref TEXT").run();
} catch {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN order_status TEXT NOT NULL DEFAULT 'escrow'").run();
} catch {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN disputed INTEGER NOT NULL DEFAULT 0").run();
} catch {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN delivery_label TEXT").run();
} catch {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN dispute_reason TEXT").run();
} catch {}
try {
  db.prepare("ALTER TABLE transactions ADD COLUMN confirmed_at TEXT").run();
} catch {}

// Migration : table prices déjà existante sans report_count (bases créées avant)
try {
  db.exec("ALTER TABLE prices ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0");
} catch {
  /* colonne déjà présente */
}

// Migration : photos des annonces (bases créées avant l'ajout de la colonne image)
try {
  db.exec("ALTER TABLE offers ADD COLUMN image TEXT");
} catch {
  /* colonne déjà présente */
}

// Migration : notifications de message → colonne offer_id (base créée avant)
// Permet à la cloche de naviguer vers la conversation au clic.
try {
  db.exec("ALTER TABLE notifications ADD COLUMN offer_id TEXT REFERENCES offers(id)");
} catch {
  /* colonne déjà présente */
}

// Migration : accusés de lecture des messages (base créée avant) — badge "non
// lu" par conversation et double coche comme sur WhatsApp.
try {
  db.exec("ALTER TABLE messages ADD COLUMN seen INTEGER NOT NULL DEFAULT 0");
} catch {
  /* colonne déjà présente */
}

// Migration : messages vocaux (kind, audio_url, duration_ms).
for (const col of [
  ["kind", "TEXT NOT NULL DEFAULT 'text'"],
  ["audio_url", "TEXT"],
  ["duration_ms", "INTEGER"],
]) {
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN ${col[0]} ${col[1]}`);
  } catch {
    /* colonne déjà présente */
  }
}

// Migration : rôle livreur + blocage du compte (bases créées avant)
// SQLite ne permet pas d'élargir un CHECK en place → on reconstruit la table.
// NB : legacy_alter_table=ON empêche RENAME de réécrire les FK vers users_old.
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes("blocked")) {
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  db.transaction(() => {
    db.exec(`
      ALTER TABLE users RENAME TO users_old;
      CREATE TABLE users (
        id         TEXT PRIMARY KEY,
        full_name  TEXT NOT NULL,
        phone      TEXT UNIQUE NOT NULL,
        password   TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'producer' CHECK (role IN ('producer','buyer','courier','admin')),
        region     TEXT,
        village    TEXT,
        avatar     TEXT,
        ussd_code  TEXT,
        verified   INTEGER NOT NULL DEFAULT 0,
        blocked    INTEGER NOT NULL DEFAULT 0,
        blocked_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users (id, full_name, phone, password, role, region, village, avatar, ussd_code, verified, created_at, blocked, blocked_reason)
        SELECT id, full_name, phone, password, role, region, village, avatar, ussd_code, verified, created_at, 0, NULL FROM users_old;
      DROP TABLE users_old;
    `);
  })();
  db.pragma("legacy_alter_table = OFF");
  db.pragma("foreign_keys = ON");
  console.log("[db] migration users → rôle courier + blocage");
}

export default db;

// =====================================================================
// Migrations : identité Google + dossier livreur (photo, pièce d'identité)
// Ajout de colonnes simples (ALTER) — idempotent via try/catch.
// =====================================================================
const userColsV2 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
for (const col of [
  ["auth_provider", "TEXT NOT NULL DEFAULT 'sms'"],
  ["google_uid", "TEXT"],
  ["email", "TEXT"],
  ["locality", "TEXT"],
  ["transport", "TEXT"],
  ["selfie", "TEXT"],
  ["id_front", "TEXT"],
  ["id_back", "TEXT"],
  ["doc_status", "TEXT NOT NULL DEFAULT 'pending'"],
  ["doc_updated_at", "TEXT"],
]) {
  if (!userColsV2.includes(col[0])) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col[0]} ${col[1]}`);
    } catch {
      /* déjà présent */
    }
  }
}

// Migration : suppression de compte (anonymisation — exigence Google Play).
// Une fois supprimé, le compte est neutralisé mais sa ligne reste (contraintes
// FK des transactions/délivrances) : anonymized=1 empêche toute réactivation.
const userColsV3 = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
for (const col of [
  ["anonymized", "INTEGER NOT NULL DEFAULT 0"],
  ["deleted_at", "TEXT"],
]) {
  if (!userColsV3.includes(col[0])) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col[0]} ${col[1]}`);
    } catch {
      /* déjà présent */
    }
  }
}
