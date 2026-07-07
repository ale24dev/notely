# Notely 📝

Gestor de notas en **Markdown** que vive en el **menu bar de macOS**, construido con [Tauri 2](https://v2.tauri.app).

## Características

- 🖥️ **Menu bar app**: un icono en la barra de menús abre un popover con tus notas. Sin icono en el Dock, sin ventanas por medio.
- ✍️ **Markdown**: escribe con resaltado monoespaciado y alterna a vista previa renderizada (GFM: tablas, listas de tareas, etc.).
- ☑️ **Checklists interactivas**: marca y desmarca las casillas `- [ ]` directamente en la vista previa; el cambio se escribe de vuelta en el Markdown.
- 🎨 **Resaltado de sintaxis** en los bloques de código de la vista previa (highlight.js, temas claro y oscuro).
- 🏷️ **Etiquetas con colores**: crea etiquetas con el chip **＋ etiqueta** de la lista (elige el color al momento) o añádelas a una nota desde el campo **+ etiqueta** del editor, con autocompletado; también puedes escribir `#tag` directamente en el texto. Cada etiqueta recibe un color de la paleta de sistema de Apple (estable, derivado del nombre) y puedes cambiarlo pulsando el punto de color del chip (o con clic derecho). Los chips filtran la lista al hacer clic y la búsqueda también encuentra tags. Los colores se guardan en `tag_colors.json`; una etiqueta creada que ninguna nota use se puede quitar desde el propio selector de color.
- 📌 **Notas fijadas**: ancla las importantes para que queden siempre arriba de la lista.
- 🚀 **Abrir al iniciar sesión**: actívalo desde el pie de la lista de notas.
- 💾 **Guardado automático**: las notas se guardan mientras escribes como archivos `.md` en `~/Library/Application Support/com.notely.app/notes/` — tuyas para siempre, sin formatos propietarios.
- 🔍 **Búsqueda** instantánea por título, contenido y etiquetas.
- 🌗 Tema claro/oscuro automático según el sistema.

## Atajos de teclado

| Atajo | Acción |
| --- | --- |
| `⌘N` | Nueva nota |
| `⌘E` | Alternar editor / vista previa |
| `Esc` | Volver a la lista · cerrar el popover |
| `⌘Q` | Salir de la app |

Cualquier clic en el icono del menu bar abre/cierra el popover, que también se cierra automáticamente al hacer clic fuera de él. Para salir de la app usa el botón de apagado de la lista de notas (o `⌘Q` con el popover abierto). Los iconos de la interfaz son SVG inline estilo Cupertino (`src/icons.ts`), teñidos con `currentColor` para adaptarse al tema. El tray no lleva menú nativo a propósito: en macOS un menú adjunto puede quedarse con los clics y impedir que el popover se abra.

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
