import { listen } from "@tauri-apps/api/event";
import { getTheme, setTheme as persistTheme, type Theme } from "./api";

export type { Theme };

function apply(theme: Theme) {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

/// Aplica el tema guardado en esta ventana y se suscribe a los cambios que
/// se hagan desde otra (p. ej. la de Ajustes). Llamar una vez por ventana.
export async function initTheme(): Promise<void> {
  try {
    apply(await getTheme());
  } catch {
    // Sin ajuste guardado todavía; se queda en "sistema" (sin atributo).
  }
  void listen<Theme>("theme-changed", (event) => apply(event.payload));
}

/// Cambia el tema: lo aplica en esta ventana al momento y lo persiste, lo
/// que emite el evento que actualiza las demás ventanas abiertas.
export async function changeTheme(theme: Theme): Promise<void> {
  apply(theme);
  await persistTheme(theme);
}
