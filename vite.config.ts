import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The page lives in src/web. In development the server (src/server/main.ts)
// runs Vite in middleware mode on its own port.
export default defineConfig({
  root: fileURLToPath(new URL("src/web", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("dist/web", import.meta.url)),
    emptyOutDir: true,
  },
});
