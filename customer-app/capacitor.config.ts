import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.aqabaseago.app",
  appName: "Aqaba SeaGo",
  webDir: "dist",
  backgroundColor: "#071F33",
  server: {
    androidScheme: "https"
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      // React hides this once the approved web artwork is decoded. Auto-hide
      // remains a bounded fallback so a failed JS bundle exposes boot recovery.
      launchFadeOutDuration: 0,
      backgroundColor: "#071F33",
      androidScaleType: "FIT_CENTER",
      showSpinner: false
    }
  }
};

export default config;
