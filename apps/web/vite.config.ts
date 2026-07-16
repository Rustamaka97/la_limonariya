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
      workbox: {
        // янги build дарҳол назоратни олади — "эски кэш" муаммосига қарши
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // tRPC query'лар (GET) — интернет узилганда охирги кўрилган маълумот
            // очилади (фақат КЎРИШ; мутациялар атай навбатга олинмайди — кўр-кўрона
            // replay заказни икки марта ёзиши мумкин).
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith("/trpc") && request.method === "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "trpc-queries",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 300, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    // Публичный превью-туннель (Cloudflare) — разрешаем *.trycloudflare.com.
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/trpc": process.env.VITE_API_TARGET || "http://localhost:3000",
      "/api": process.env.VITE_API_TARGET || "http://localhost:3000",
    },
  },
});
