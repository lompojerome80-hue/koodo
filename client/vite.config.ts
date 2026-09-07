import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "Koodo — le marché à portée de main",
        short_name: "Koodo",
        description: "Prix du marché, ventes directes et messages sans réseau, pour les producteurs d'Afrique de l'Ouest.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#F7F3E8",
        theme_color: "#1B4332",
        lang: "fr",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === "https://firebasestorage.googleapis.com" || url.origin === "https://firestore.googleapis.com",
            handler: "CacheFirst",
            options: {
              cacheName: "koodo-firebase",
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts" }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-static" }
          },
          {
            urlPattern: /\/api\/.*/,
            handler: "NetworkFirst",
            options: {
              cacheName: "koodo-api",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 }
            }
          }
        ]
      },
      devOptions: { enabled: true }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000"
    }
  }
});
