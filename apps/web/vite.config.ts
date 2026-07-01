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
        theme_color: "#0e4037",
        background_color: "#fdf8f2",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/brand/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/trpc": process.env.VITE_API_TARGET || "http://localhost:3000",
      "/api": process.env.VITE_API_TARGET || "http://localhost:3000",
    },
  },
});
