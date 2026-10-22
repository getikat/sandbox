import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    // xfwd tells the API who the real client is, so remote-access auth holds
    // even when requests arrive through the dev proxy.
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.IKAT_API_PORT ?? 4546}`,
        xfwd: true,
      },
    },
  },
  build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 1200 },
});
