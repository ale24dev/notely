// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod notes;

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{
    tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_positioner::{Position, WindowExt};

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

// En macOS la ventana se convierte en un NSPanel no activante: es la única
// forma fiable de mostrarla sobre apps a pantalla completa sin activar
// Notely ni provocar un cambio de Space.
#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(NotelyPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    })

    panel_event!(NotelyPanelEvents {
        window_did_resign_key(notification: &NSNotification) -> ()
    })
}

/// Momento en que el popover se ocultó por última vez al perder el foco.
/// Permite distinguir "clic en el icono para cerrar" de "clic para abrir".
struct LastHide(Mutex<Option<Instant>>);

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    // En macOS el cierre al perder foco lo gestiona window_did_resign_key
    // del panel; en el resto de plataformas, el evento de foco de la ventana.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.on_window_event(|window, event| {
        if let tauri::WindowEvent::Focused(false) = event {
            if window.hide().is_ok() {
                let state = window.state::<LastHide>();
                *state.0.lock().unwrap() = Some(Instant::now());
            }
        }
    });

    builder
        .manage(LastHide(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            quit,
            notes::list_notes,
            notes::load_note,
            notes::save_note,
            notes::create_note,
            notes::delete_note,
            notes::toggle_pin,
            notes::get_tag_colors,
            notes::set_tag_color,
            notes::delete_tag_color
        ])
        .setup(|app| {
            // La app vive solo en el menu bar: sin icono en el Dock.
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                setup_macos_panel(app.handle())?;
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
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button_state: MouseButtonState::Down,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar Notely");
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
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

    Ok(())
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

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.move_window(Position::TrayCenter);
    }
    // Ordena el panel al frente y lo hace ventana clave sin activar la app:
    // el teclado funciona y la app a pantalla completa sigue activa debajo.
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

    let _ = window.move_window(Position::TrayCenter);
    let _ = window.show();
    let _ = window.set_focus();
}
