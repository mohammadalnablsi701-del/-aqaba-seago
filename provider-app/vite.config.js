import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = process.env.VITE_APP_BASE || "/-aqaba-seago/provider/";

export default defineConfig({
  plugins: [react()],
  base,
});
