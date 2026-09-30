import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const disableCrossOriginIsolation =
  process.env.VITE_DISABLE_CROSS_ORIGIN_ISOLATION === "true";
const crossOriginIsolationHeaders = disableCrossOriginIsolation
  ? undefined
  : {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    };

export default defineConfig({
  plugins: [react()],
  server: crossOriginIsolationHeaders
    ? { headers: crossOriginIsolationHeaders }
    : undefined,
  preview: crossOriginIsolationHeaders
    ? { headers: crossOriginIsolationHeaders }
    : undefined,
  build: {
    target: "es2022"
  }
});
