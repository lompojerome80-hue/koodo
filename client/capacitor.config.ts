import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ci.koodo.app",
  appName: "Koodo",
  webDir: "dist",
  server: {
    androidScheme: "https"
  }
};

export default config;