import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = process.env.VITE_APP_BASE || "/-aqaba-seago/provider/";
const previewAllowedHost = process.env.VITE_PREVIEW_ALLOWED_HOST;

export default defineConfig({
  plugins: [react()],
  base,
  preview: previewAllowedHost
    ? { allowedHosts: [previewAllowedHost] }
    : undefined,
});
