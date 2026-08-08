import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getWidgetEnabled, isSandboxed, setWidgetEnabled } from "./api";
import { changeTheme, initTheme, type Theme } from "./theme";

const themeSwitch = document.querySelector<HTMLElement>("#theme-switch")!;
const themeOptions = document.querySelectorAll<HTMLButtonElement>(".theme-option");
const autostartToggle = document.querySelector<HTMLInputElement>("#autostart-toggle")!;
const widgetToggle = document.querySelector<HTMLInputElement>("#widget-toggle")!;

// ---- Tema ----
function markActiveTheme(theme: Theme) {
  for (const btn of themeOptions) {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  }
}

async function initThemeSwitch() {
  // El propio módulo de tema ya aplica el guardado a esta ventana; aquí
  // solo hace falta reflejarlo en los botones y guardar el estado inicial
  // para saber cuál marcar activo (initTheme no expone el valor leído).
  const stored = (document.documentElement.dataset.theme as Theme | undefined) ?? "system";
  markActiveTheme(stored);

  themeSwitch.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".theme-option");
    if (!btn?.dataset.theme) return;
    const theme = btn.dataset.theme as Theme;
    markActiveTheme(theme);
    void changeTheme(theme);
  });

  // Si el tema cambia desde otra ventana, refleja la selección aquí también.
  void listen<Theme>("theme-changed", (event) => markActiveTheme(event.payload));
}

// ---- Abrir al iniciar sesión ----
async function initAutostart() {
  // En el build de la Mac App Store (App Sandbox) el autostart por
  // LaunchAgent no está permitido: se oculta la opción.
  try {
    if (await isSandboxed()) {
      autostartToggle.closest("label")?.classList.add("hidden");
      return;
    }
  } catch {
    // Si no se puede determinar, se muestra la opción normalmente.
  }
  try {
    autostartToggle.checked = await isEnabled();
  } catch {
    // El plugin puede no estar disponible (p. ej. permisos); se deja apagado.
  }
  autostartToggle.addEventListener("change", async () => {
    try {
      if (autostartToggle.checked) {
        await enable();
      } else {
        await disable();
      }
    } catch {
      autostartToggle.checked = !autostartToggle.checked;
    }
  });
}

// ---- Widget de escritorio ----
async function initWidgetToggle() {
  try {
    widgetToggle.checked = await getWidgetEnabled();
  } catch {
    // Sin ajuste guardado; se deja apagado.
  }
  widgetToggle.addEventListener("change", async () => {
    try {
      await setWidgetEnabled(widgetToggle.checked);
    } catch {
      widgetToggle.checked = !widgetToggle.checked;
    }
  });
}

async function init() {
  await initTheme();
  await initThemeSwitch();
  await initAutostart();
  await initWidgetToggle();
}

void init();
