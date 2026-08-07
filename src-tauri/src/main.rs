// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod notes;

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{
    tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalSize,
};

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

// En macOS las ventanas se convierten en NSPanel: es la única forma fiable
// de mostrar el popover sobre apps a pantalla completa sin activar Notely,
// y permite transparencia y esquinas redondeadas con APIs públicas de
// AppKit (requisito de la Mac App Store: nada de APIs privadas).
#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(NotelyPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })

    panel!(NotelyWidgetPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: false
        }
    })

    panel_event!(NotelyPanelEvents {
        window_did_resign_key(notification: &NSNotification) -> ()
    })
}

/// Momento en que el popover se ocultó por última vez al perder el foco.
/// Permite distinguir "clic en el icono para cerrar" de "clic para abrir".
struct LastHide(Mutex<Option<Instant>>);

/// Posición y tamaño del icono del tray, capturados en cada clic. Se usa
/// para colocar el popover justo debajo del icono — a mano, en lugar de con
/// tauri-plugin-positioner: su `Position::TrayCenter` en macOS, cuando el
/// resultado natural da negativo (el caso normal, porque el popover es
/// mucho más alto que el hueco disponible encima del icono), cae de vuelta
/// a `y = tray_y`, el borde SUPERIOR del icono — que está dentro de la
/// franja del menu bar — así que el popover terminaba tapando la barra de
/// menús en lugar de aparecer debajo.
struct TrayRect(Mutex<Option<(PhysicalPosition<f64>, PhysicalSize<f64>)>>);

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        // Recuerda dónde dejó el usuario el widget de escritorio. El popover
        // ("main") queda excluido a propósito: su posición la recalcula
        // popover_position() en cada apertura a partir del icono del tray,
        // y no debe restaurarse ni guardarse por su cuenta.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE,
                )
                .with_denylist(&["main"])
                .build(),
        )
        // Protocolo notely:// para servir las imágenes pegadas en las notas
        // (guardadas en el directorio de adjuntos de la app).
        .register_uri_scheme_protocol("notely", |ctx, request| {
            let not_found = || {
                tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap()
            };

            let uri = request.uri();
            if uri.host() != Some("attachments") {
                return not_found();
            }
            let name = uri.path().trim_start_matches('/');
            // Solo nombres generados por la app: nada de rutas ni escapes.
            let valid = !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
                && !name.contains("..");
            if !valid {
                return not_found();
            }

            let Ok(dir) = notes::attachments_dir(ctx.app_handle()) else {
                return not_found();
            };
            match std::fs::read(dir.join(name)) {
                Ok(bytes) => tauri::http::Response::builder()
                    .header("Content-Type", "image/png")
                    .body(bytes)
                    .unwrap(),
                Err(_) => not_found(),
            }
        });

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    // En macOS el cierre al perder foco lo gestiona window_did_resign_key
    // del panel; en el resto de plataformas, el evento de foco de la ventana.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.on_window_event(|window, event| {
        // Solo el popover se cierra al perder el foco; el widget de
        // escritorio permanece visible.
        if window.label() != "main" {
            return;
        }
        if let tauri::WindowEvent::Focused(false) = event {
            if window.hide().is_ok() {
                let state = window.state::<LastHide>();
                *state.0.lock().unwrap() = Some(Instant::now());
            }
        }
    });

    builder
        .manage(LastHide(Mutex::new(None)))
        .manage(TrayRect(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            quit,
            is_sandboxed,
            open_note,
            notes::list_notes,
            notes::load_note,
            notes::save_note,
            notes::create_note,
            notes::delete_note,
            notes::toggle_pin,
            notes::get_tag_colors,
            notes::set_tag_color,
            notes::delete_tag_color,
            notes::get_widget_enabled,
            notes::set_widget_enabled,
            notes::paste_from_clipboard
        ])
        .setup(|app| {
            // Trae las notas guardadas bajo el identifier antiguo, si las hay.
            notes::migrate_legacy_data(app.handle());

            // La app vive solo en el menu bar: sin icono en el Dock.
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                setup_macos_panel(app.handle())?;

                // Menú de edición: sin él, macOS no enruta ⌘V/⌘C/⌘X/⌘A al
                // webview. No se ve (app Accessory) pero habilita los atajos.
                // Sin ítems de deshacer/rehacer: los gestiona la app con su
                // propio historial (el nativo se rompe con las ediciones
                // programáticas) y el menú los interceptaría.
                use tauri::menu::{MenuBuilder, SubmenuBuilder};
                let edit = SubmenuBuilder::new(app, "Edición")
                    .cut()
                    .copy()
                    .paste()
                    .separator()
                    .select_all()
                    .build()?;
                let menu = MenuBuilder::new(app).item(&edit).build()?;
                app.set_menu(menu)?;
            }

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;

            // Sin menú nativo: si el tray tiene un menú adjunto, macOS puede
            // quedarse los clics para mostrarlo y la ventana nunca se abre.
            // Cualquier clic (izquierdo o derecho) alterna el popover; salir
            // de la app se hace desde la propia UI (botón de apagado o ⌘Q).
            TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("Notely")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        rect,
                        button_state: MouseButtonState::Down,
                        ..
                    } = &event
                    {
                        let handle = tray.app_handle();
                        // tray-icon emite el rect en físico: to_physical(1.0)
                        // solo extrae la variante, no reescala nada.
                        handle.state::<TrayRect>().0.lock().unwrap().replace((
                            rect.position.to_physical(1.0),
                            rect.size.to_physical(1.0),
                        ));
                        toggle_window(handle);
                    }
                })
                .build(app)?;

            // Restaura el widget de escritorio si el usuario lo dejó activo.
            if notes::load_settings(app.handle()).widget_enabled {
                apply_widget_visibility(app.handle(), true);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar Notely");
}

/// Muestra u oculta la ventana-widget del escritorio.
pub fn apply_widget_visibility(app: &AppHandle, visible: bool) {
    if let Some(widget) = app.get_webview_window("widget") {
        if visible {
            let _ = widget.show();
        } else {
            let _ = widget.hide();
        }
    }
}

/// Abre una nota concreta en el popover (invocado desde el widget).
#[tauri::command]
fn open_note(app: AppHandle, id: String) {
    use tauri::Emitter;
    let _ = app.emit_to("main", "open-note", id);
    show_popover(&app);
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// ¿Corre la app dentro del App Sandbox (build de Mac App Store)? Algunas
/// funciones (autostart por LaunchAgent) no están permitidas ahí y la UI
/// las oculta.
#[tauri::command]
fn is_sandboxed() -> bool {
    std::env::var("APP_SANDBOX_CONTAINER_ID").is_ok()
}

/// Convierte la ventana principal en un panel del menu bar: no activante
/// (no roba el foco de la app en uso), visible en cualquier Space incluidos
/// los de pantalla completa, y flotando al nivel de la barra de estado.
#[cfg(target_os = "macos")]
fn setup_macos_panel(app: &AppHandle) -> tauri::Result<()> {
    let window = app
        .get_webview_window("main")
        .expect("la ventana principal debe existir");
    let panel = window.to_panel::<NotelyPanel>()?;

    panel.set_level(PanelLevel::Status.value());
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .into(),
    );
    panel.set_hides_on_deactivate(false);
    // La ventana se mantiene OPACA a propósito: sin la API privada (que la
    // App Store rechaza) el webview no puede ser transparente, y un webview
    // opaco dentro de una ventana transparente se renderiza en negro en
    // macOS. El fondo lo pinta el CSS; set_corner_radius recorta las esquinas
    // sobre el fondo de ventana opaco del sistema (radio igual que el CSS).
    panel.set_corner_radius(12.0);

    // Comportamiento de popover: se oculta al dejar de ser ventana clave
    // (clic fuera, cambio de app…).
    let events = NotelyPanelEvents::new();
    let handle = app.clone();
    events.window_did_resign_key(move |_notification| {
        // El panel sustituye al delegate de tao, así que el frontend ya no
        // recibe tauri://blur: se avisa con un evento propio para que
        // guarde los cambios pendientes antes de ocultarse.
        use tauri::Emitter;
        let _ = handle.emit("panel-blur", ());
        if let Ok(panel) = handle.get_webview_panel("main") {
            if panel.is_visible() {
                panel.hide();
                let state = handle.state::<LastHide>();
                *state.0.lock().unwrap() = Some(Instant::now());
            }
        }
    });
    panel.set_event_handler(Some(events.as_ref()));

    // El widget de escritorio también pasa a ser panel: no activante (los
    // clics en sus checklists no roban el foco de la app en uso), fijo en
    // todos los Spaces y con las esquinas redondeadas por AppKit.
    let widget = app
        .get_webview_window("widget")
        .expect("la ventana del widget debe existir");
    let widget_panel = widget.to_panel::<NotelyWidgetPanel>()?;
    widget_panel.set_style_mask(StyleMask::empty().nonactivating_panel().resizable().into());
    widget_panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .stationary()
            .into(),
    );
    widget_panel.set_hides_on_deactivate(false);
    // Opaco también (ver nota del popover): evita el render en negro.
    widget_panel.set_corner_radius(16.0);

    Ok(())
}

/// Calcula dónde debe aparecer el popover: centrado bajo el icono del tray
/// y pegado al borde inferior de la franja del menu bar (nunca superpuesto
/// — ver el comentario de [`TrayRect`]), igual que los popovers nativos del
/// sistema. Si el icono aún no ha registrado ninguna posición (no debería
/// pasar: se captura justo antes de llamar aquí), no se mueve la ventana y
/// se deja donde esté.
fn popover_position(app: &AppHandle, window: &tauri::WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let (tray_pos, tray_size) = (*app.state::<TrayRect>().0.lock().unwrap())?;
    let window_size = window.outer_size().ok()?;

    // El rect del icono es el de la NSWindow del status item, que ya abarca
    // toda la franja del menu bar (no solo el glifo del icono): su borde
    // inferior coincide exactamente con el borde inferior del menu bar, así
    // que sin margen adicional el popover queda pegado a él, sin hueco.
    let mut x = tray_pos.x + tray_size.width / 2.0 - window_size.width as f64 / 2.0;
    let y = tray_pos.y + tray_size.height;

    // No dejar que el popover se salga por el borde derecho de la pantalla
    // (los iconos del tray suelen estar pegados a esa esquina).
    if let Ok(Some(monitor)) = window.current_monitor() {
        let right_edge = (monitor.position().x + monitor.size().width as i32) as f64;
        let left_edge = monitor.position().x as f64;
        x = x.min(right_edge - window_size.width as f64).max(left_edge);
    }

    Some(PhysicalPosition::new(x.round() as i32, y.round() as i32))
}

/// ¿Se ocultó el popover hace un instante? Si es así, el blur lo provocó el
/// mismo clic en el icono que estamos procesando: el usuario quería cerrar.
fn just_hidden(app: &AppHandle) -> bool {
    app.state::<LastHide>()
        .0
        .lock()
        .unwrap()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(300))
}

#[cfg(target_os = "macos")]
fn toggle_window(app: &AppHandle) {
    let Ok(panel) = app.get_webview_panel("main") else {
        return;
    };

    if panel.is_visible() {
        panel.hide();
        return;
    }

    if just_hidden(app) {
        return;
    }

    show_popover(app);
}

/// Muestra el popover: lo posiciona bajo el icono del tray (si hay una
/// posición conocida) y lo ordena al frente como ventana clave sin activar
/// la app, de modo que funciona incluso sobre apps a pantalla completa.
#[cfg(target_os = "macos")]
fn show_popover(app: &AppHandle) {
    let Ok(panel) = app.get_webview_panel("main") else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        if let Some(pos) = popover_position(app, &window) {
            let _ = window.set_position(pos);
        }
    }
    panel.show_and_make_key();
}

#[cfg(not(target_os = "macos"))]
fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    if just_hidden(app) {
        return;
    }

    show_popover(app);
}

#[cfg(not(target_os = "macos"))]
fn show_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Some(pos) = popover_position(app, &window) {
        let _ = window.set_position(pos);
    }
    let _ = window.show();
    let _ = window.set_focus();
}
