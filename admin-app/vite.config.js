import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";

// Keep the production Pages path; allow a root-base Render QA preview.
const base=process.env.VITE_APP_BASE||"/-aqaba-seago/admin/";
export default defineConfig({plugins:[react()],base});
