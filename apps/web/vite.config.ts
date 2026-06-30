import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "La Limonariya",
        short_name: "Limonariya",
        lang: "uz",
        theme_color: "#16a34a",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [],
      },
    }),
  ],
  server: {
    proxy: {
      "/trpc": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
