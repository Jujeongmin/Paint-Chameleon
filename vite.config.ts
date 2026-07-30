import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The client app lives in game/, not at the repo root.
 *
 * Vite resolves modules relative to `root` and refuses to serve above it, so
 * index.html and src/ have to sit inside it together — index.html's
 * /src/main.tsx is root-relative. publicDir and outDir are then relative to
 * game/ and point back out, so public/ and dist/ stay where the rest of the
 * project (and the deploy step) expects them.
 *
 * server/ and scripts/ are outside the root on purpose: neither is part of the
 * bundle. The check scripts import the client tree by relative path.
 */
export default defineConfig({
  root: "game",
  publicDir: "../public",
  plugins: [react()],
  // Honour an assigned PORT so multiple dev servers can coexist.
  server: { port: process.env.PORT ? Number(process.env.PORT) : 5173 },
  build: {
    target: "es2020",
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // three.js is the bulk of the bundle; split it so the app shell boots fast.
        manualChunks: { three: ["three"] },
      },
    },
  },
});
