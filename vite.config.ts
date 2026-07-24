import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Honour an assigned PORT so multiple dev servers can coexist.
  server: { port: process.env.PORT ? Number(process.env.PORT) : 5173 },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        // three.js is the bulk of the bundle; split it so the app shell boots fast.
        manualChunks: { three: ["three"] },
      },
    },
  },
});
