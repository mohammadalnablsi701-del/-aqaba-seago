import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.aqabaseago.app",
  appName: "Aqaba SeaGo",
  webDir: "dist",
  server: {
    androidScheme: "https"
  }
};

export default config;
