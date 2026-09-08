import "dotenv/config";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import "./db.js";
import { seed } from "./seed.js";
import authRoutes from "./routes/auth.routes.js";
import marketRoutes from "./routes/market.routes.js";
import offerRoutes from "./routes/offer.routes.js";
import msgRoutes from "./routes/msg.routes.js";
import alertRoutes from "./routes/alert.routes.js";
import payRoutes from "./routes/pay.routes.js";
import ussdRoutes from "./routes/ussd.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import deliveryRoutes, { startDuesScheduler } from "./routes/delivery.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import eventRoutes from "./routes/events.routes.js";
import supportRoutes from "./routes/support.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { uploadsDir } from "./uploads.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Sécurité production : ne restreindre les origines que si CORS_ORIGIN est défini.
// En développement (défaut), toutes les origines sont acceptées (vite sur 5173).
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin.split(",").map((o) => o.trim()) } : {}));
app.use(express.json({ limit: "8mb" }));

// Photos du dossier livreur (stockées sur nos serveurs : data/uploads).
app.use("/uploads", express.static(uploadsDir));

if (app.get("env") === "production" && (process.env.JWT_SECRET || "") === "") {
  console.warn("⚠  JWT_SECRET non défini — Jeton signé avec la clé de développement par défaut. Définis JWT_SECRET en production.");
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "koodo-api" }));

app.use("/api/auth", authRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/messages", msgRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/payments", payRoutes);
app.use("/api/ussd", ussdRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/deliveries", deliveryRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/admin", adminRoutes);

// Serve built client in production
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  const index = path.join(clientDist, "index.html");
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(200).send("Koodo API — run the client dev server (npm run dev)");
});

const PORT = process.env.PORT || 4000;
seed();
startDuesScheduler();
app.listen(PORT, () => {
  console.log(`Koodo API running at http://localhost:${PORT}`);
});
