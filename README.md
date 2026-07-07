# Notely 📝

Gestor de notas en **Markdown** que vive en el **menu bar de macOS**, construido con [Tauri 2](https://v2.tauri.app).

## Características

- 🖥️ **Menu bar app**: un icono en la barra de menús abre un popover con tus notas. Sin icono en el Dock, sin ventanas por medio.
- ✍️ **Markdown**: escribe con resaltado monoespaciado y alterna a vista previa renderizada (GFM: tablas, listas de tareas, etc.).
- 💾 **Guardado automático**: las notas se guardan mientras escribes como archivos `.md` en `~/Library/Application Support/com.notely.app/notes/` — tuyas para siempre, sin formatos propietarios.
- 🔍 **Búsqueda** instantánea por título y contenido.
- 🌗 Tema claro/oscuro automático según el sistema.

## Atajos de teclado

| Atajo | Acción |
| --- | --- |
| `⌘N` | Nueva nota |
| `⌘E` | Alternar editor / vista previa |
| `Esc` | Volver a la lista · cerrar el popover |

El popover también se cierra automáticamente al hacer clic fuera de él. Para salir de la app: clic derecho en el icono del menu bar → **Salir de Notely**.

## Desarrollo

Requisitos: [Node.js](https://nodejs.org) ≥ 20 y [Rust](https://rustup.rs).

```bash
npm install
npm run tauri dev
```

## Compilar para macOS

```bash
npm run tauri build
```

Genera `Notely.app` y un `.dmg` en `src-tauri/target/release/bundle/`.

## Estructura

```
├── src/                  # Frontend (Vite + TypeScript)
│   ├── main.ts           # UI: lista, editor, vista previa, atajos
│   └── api.ts            # Wrappers de los comandos Tauri
├── src-tauri/
│   ├── src/main.rs       # Tray icon, popover, ciclo de vida
│   ├── src/notes.rs      # Comandos: listar/crear/guardar/borrar notas
│   └── tauri.conf.json   # Configuración de la app y la ventana
└── assets/               # SVGs fuente de los iconos
```

Los iconos se regeneran con `npx tauri icon assets/app-icon.svg`.
