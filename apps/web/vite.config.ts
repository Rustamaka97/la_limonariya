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
      workbox: {
        // yangi build darhol nazoratni oladi — "eski kesh" muammosiga qarshi
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // tRPC query'lar (GET) — internet uzilganda oxirgi ko'rilgan
            // ma'lumot ochiladi (faqat KO'RISH; mutatsiyalar ataylab navbatga
            // olinmaydi — ko'r-ko'rona replay zakazni ikki marta yozishi mumkin)
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
      "/trpc": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
