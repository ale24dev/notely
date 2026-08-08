import { defineConfig, type Plugin } from "vite";

// Vite marca los <script type="module"> y <link> con `crossorigin`, lo que
// hace que el navegador los cargue en modo CORS. En el .app empaquetado de
// Tauri, servidos por el protocolo tauri:// (sin cabeceras CORS), esas
// peticiones se bloquean y el webview queda en blanco/gris. En el servidor
// de dev (http) no pasa. Quitamos el atributo del HTML generado.
function stripCrossorigin(): Plugin {
  return {
    name: "notely-strip-crossorigin",
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin/g, "");
    },
  };
}

// Configuración recomendada por Tauri: https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  clearScreen: false,
  plugins: [stripCrossorigin()],
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
        settings: "settings.html",
      },
    },
  },
});
