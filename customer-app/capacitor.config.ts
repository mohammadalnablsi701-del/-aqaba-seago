import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.aqabaseago.app",
  appName: "Aqaba SeaGo",
  webDir: "dist",
  server: {
    androidScheme: "https"
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: "#071F33",
      showSpinner: false
    }
  }
};

export default config;
