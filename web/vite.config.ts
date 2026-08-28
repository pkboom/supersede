import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Local-dev ports. The Hono server binds 5174 in `npm run dev`; Vite serves
// the UI on 5173 and proxies /api over to the server. Browser opens 5173.
const API_PORT = Number(process.env.EMAIL_DESIGNER_DEV_API_PORT ?? 5174);
const VITE_PORT = Number(process.env.EMAIL_DESIGNER_DEV_VITE_PORT ?? 5173);

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      // Strategy A: shared block-tree code lives at src/shared/blocks/.
      // Both Vite and tsc need to resolve "@shared/blocks/..." to that path.
      "@shared": resolve(projectRoot, "src/shared"),
    },
  },
  server: {
    port: VITE_PORT,
    strictPort: true,
    fs: {
      // Allow Vite dev server to read files outside web/ (specifically
      // src/shared/blocks/*).
      allow: [projectRoot],
    },
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    // outDir only matters if someone manually runs `vite build`; the
    // dev pipeline (`npm run dev`) serves from memory via Vite directly.
    outDir: "../dist/web",
    emptyOutDir: true,
  },
});
