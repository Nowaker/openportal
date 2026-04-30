import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const BUILD_ID = String(Date.now());

export default defineConfig({
  define: {
    __OPENPORTAL_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    nitro({
      preset: "bun",
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
