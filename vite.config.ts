import { defineConfig } from "vite";

// Configuración recomendada por Tauri: https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        widget: "widget.html",
      },
    },
  },
});
