# Notely 📝

Gestor de notas en **Markdown** que vive en el **menu bar de macOS**, construido con [Tauri 2](https://v2.tauri.app).

## Características

- 🖥️ **Menu bar app**: un icono en la barra de menús abre un popover con tus notas. Sin icono en el Dock, sin ventanas por medio.
- ✍️ **Markdown**: escribe con resaltado monoespaciado y alterna a vista previa renderizada (GFM: tablas, listas de tareas, etc.).
- ☑️ **Checklists interactivas**: marca y desmarca las casillas `- [ ]` directamente en la vista previa; el cambio se escribe de vuelta en el Markdown.
- 🎨 **Resaltado de sintaxis** en los bloques de código de la vista previa (highlight.js, temas claro y oscuro).
- 🏷️ **Etiquetas con colores**: crea etiquetas con el chip **＋ etiqueta** de la lista (elige el color al momento) o añádelas a una nota desde el pie del editor — separado del cuerpo de la nota, no se mezclan como texto con lo que escribes —, con un desplegable de sugerencias propio (con el punto de color de cada etiqueta; el `<datalist>` nativo no se puede colorear). También puedes escribir `#tag` directamente en el texto. Cada etiqueta recibe un color de la paleta de sistema de Apple (estable, derivado del nombre) y puedes cambiarlo pulsando el punto de color del chip (o con clic derecho). Los chips filtran la lista al hacer clic y la búsqueda también encuentra tags. Los colores se guardan en `tag_colors.json`; una etiqueta creada que ninguna nota use se puede quitar desde el propio selector de color.
- 📌 **Notas fijadas**: ancla las importantes para que queden siempre arriba de la lista.
- 🖼️ **Widget de escritorio**: actívalo desde Ajustes y tus notas fijadas aparecen en un panel pegado al escritorio (siempre detrás de las demás ventanas, visible en todos los Spaces). Muestra las checklists interactivas — marca tareas sin abrir la app —, se actualiza en vivo cuando cambian las notas, se puede arrastrar desde su cabecera y recuerda su posición. Clic en el título de una nota para abrirla en el popover. No usa WidgetKit (los widgets nativos de macOS requieren una extensión Swift firmada con Xcode); es una ventana de la propia app que se comporta como un widget.
- 📋 **Pegar texto e imágenes**: `⌘V` pega texto donde esté el cursor, y si el portapapeles trae una imagen (una captura, algo copiado de una web…) se guarda como PNG en el directorio de adjuntos y se inserta como `![imagen](notely://attachments/…)`; ábrela en la vista previa (`⌘E`) para verla. También se ve en el widget. `⌘C`/`⌘X`/`⌘A` también funcionan en cualquier campo.
- 💾 **Guardado automático**: las notas se guardan mientras escribes como archivos `.md` en `~/Library/Application Support/com.24notely.app/notes/` — tuyas para siempre, sin formatos propietarios.
- 🔍 **Búsqueda** instantánea por título, contenido y etiquetas.
- ⚙️ **Ajustes** (botón de engranaje o `⌘,`): abre una ventana de Preferencias de verdad —con barra de título, no un popover— para elegir el **tema** (Claro / Oscuro / Sistema, se aplica al instante en el popover y el widget) y activar "Abrir al iniciar sesión" / "Widget en el escritorio".

## Atajos de teclado

| Atajo | Acción |
| --- | --- |
| `⌘N` | Nueva nota |
| `⌘E` | Alternar editor / vista previa |
| `⌘Z` / `⇧⌘Z` | Deshacer / rehacer en el editor (historial propio que cubre también pegados, checkboxes y etiquetas) |
| `⌘,` | Abrir Ajustes |
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

## Publicar en Homebrew

Vía de distribución actual (en vez de la Mac App Store / TestFlight): un
`.dmg` firmado y notarizado por Apple, descargado directamente o instalado
con `brew install --cask`. Fuera de la Store no hay sandbox ni revisión de
Apple, pero Gatekeeper exige que el binario esté firmado con un certificado
**Developer ID** y notarizado — sin eso, macOS se niega a abrirlo con un
aviso de "app dañada" o "desarrollador no identificado".

> **Repo privado**: Homebrew necesita descargar el `.dmg` sin autenticación.
> Mientras `ale24dev/notely` sea privado, la Release con el `.dmg` tiene que
> vivir en otro repo público (o hacer público este repo antes de publicar).

### Automatizado (recomendado)

`.github/workflows/release-homebrew.yml` hace todo el ciclo en un runner de
macOS de GitHub Actions: compila, firma, notariza, crea la Release con el
`.dmg` y actualiza el Cask en `ale24dev/homebrew-notely` — sin tocar tu Mac.
El flujo de release queda en dos comandos:

```bash
# 1. Sube la versión en src-tauri/tauri.conf.json, commitea y sube a master
git add src-tauri/tauri.conf.json
git commit -m "chore: versión 0.1.7"
git push

# 2. Etiqueta esa versión — esto dispara todo el pipeline
git tag v0.1.7
git push origin v0.1.7
```

Configuración de una sola vez — 5 *secrets* en **Settings → Secrets and
variables → Actions → Repository secrets** de este repo:

| Secret | Cómo conseguirlo |
| --- | --- |
| `APPLE_CERTIFICATE` | En Acceso a Llaveros, clic derecho sobre tu certificado **"Developer ID Application"** → *Exportar* → formato `.p12`, con una contraseña. Luego: `base64 -i Certificado.p12 \| pbcopy` y pega el resultado. |
| `APPLE_CERTIFICATE_PASSWORD` | La contraseña que le pusiste al `.p12` al exportarlo (la inventas tú en ese momento). |
| `APPLE_ID` | Tu Apple ID (el email). |
| `APPLE_PASSWORD` | Una contraseña específica de app **nueva y dedicada** a este workflow (no reutilices la que usaste en local): [appleid.apple.com/account/manage](https://appleid.apple.com/account/manage) → Inicio de sesión y seguridad → Contraseñas específicas de app. |
| `HOMEBREW_TAP_TOKEN` | Un GitHub *fine-grained personal access token* ([github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)) con acceso **solo** al repo `ale24dev/homebrew-notely` y permiso `Contents: Read and write`. Hace falta porque el token por defecto del workflow no puede escribir en un repo distinto al que lo dispara. |

`APPLE_TEAM_ID` no hace falta como secret: no es información sensible (ya
está en este mismo README) y va fijo en el workflow.

> El repo es público, así que cualquiera puede ver el workflow — pero los
> *secrets* nunca se imprimen en los logs y solo se inyectan al hacer push
> de un tag (no en pull requests de gente externa), así que están a salvo.

### Manual

Con tu cuenta del Apple Developer Program (Team ID `9FU3PGG489` ya
configurado como valor por defecto):

1. Crea un certificado **Developer ID Application** — distinto de los de la
   App Store — en Xcode → Settings → Accounts → Manage Certificates → ＋.
2. Genera una contraseña específica de aplicación (no la de tu Apple ID) en
   [appleid.apple.com/account/manage](https://appleid.apple.com/account/manage)
   → Inicio de sesión y seguridad → Contraseñas específicas de app.
3. Ejecuta:

```bash
export APPLE_ID="tu-apple-id@icloud.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
./scripts/build-homebrew.sh
```

El script detecta el certificado en el llavero, compila el binario
universal, y dado que trae las credenciales de Apple en el entorno, `tauri
build` firma, notariza y adjunta el ticket de notarización (staple) de
forma automática — sin pasos manuales como en el flujo de App Store. Al
final verifica con `stapler` y `spctl` que todo quedó en regla, y muestra
el sha256 del `.dmg` para el Cask.

4. Crea una GitHub Release (tag `v<versión>`) con el `.dmg` como asset.
5. Rellena `homebrew/notely.rb.in` con la versión y el sha256 que imprimió
   el script, y publícalo como `Casks/notely.rb` en un **tap personal**
   (p. ej. `github.com/ale24dev/homebrew-notely` — un repo nuevo con ese
   único archivo). El tap oficial `homebrew/homebrew-cask` exige criterios
   de notoriedad (estrellas, uso) que una app nueva normalmente no cumple
   todavía; un tap propio no necesita aprobación de nadie.
6. Instalación para cualquiera:

```bash
brew tap ale24dev/notely
brew install --cask notely
```

## Publicar en la Mac App Store (en pausa)

Se dejó todo el andamiaje montado por si se retoma más adelante, pero no es
la vía activa ahora mismo — no hace falta tocar nada de esta sección para
distribuir por Homebrew.

La app es compatible con la App Store: no usa APIs privadas (transparencia y
esquinas redondeadas van por AppKit público vía `tauri-nspanel`, vendorizado
en `src-tauri/vendor/`), funciona con App Sandbox, y en el build sandboxeado
la opción "Abrir al iniciar sesión" se oculta sola (los LaunchAgents no están
permitidos ahí).

> **Nota**: los entitlements incluyen `com.apple.security.network.client`,
> obligatorio en apps sandboxeadas con WKWebView — sin él el webview no carga
> y la ventana sale en negro (solo se nota en el build firmado/TestFlight, no
> en `tauri build --debug`, que no va en sandbox).

Con tu cuenta del Apple Developer Program (Team ID `9FU3PGG489` ya
configurado como valor por defecto):

1. Registra el App ID `com.24notely.app` en el portal de desarrolladores
   y crea la app en App Store Connect.
2. Instala los certificados **Apple Distribution** y **Mac Installer
   Distribution** en el llavero (Xcode → Settings → Accounts → Manage
   Certificates → ＋) y descarga en `~/Downloads` un provisioning profile de
   tipo *Mac App Store* para ese App ID.
3. Ejecuta:

```bash
./scripts/build-appstore.sh
```

El script detecta solo los certificados en el llavero y el provisioning
profile más reciente de `~/Downloads` (todo se puede fijar por variables de
entorno: `APPLE_TEAM_ID`, `APPLE_SIGNING_IDENTITY`,
`APPLE_INSTALLER_IDENTITY`, `APPLE_PROVISIONING_PROFILE`).

4. Sube el `.pkg` resultante con la app **Transporter** y completa la ficha
   en App Store Connect (capturas, descripción, privacidad) antes de enviar
   a revisión.

Al cambiar el identifier, la app migra automáticamente las notas guardadas
bajo el antiguo (`com.notely.app`) la primera vez que arranca.

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
