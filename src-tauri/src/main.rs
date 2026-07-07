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

/// Momento en que el popover se ocultó por última vez al perder el foco.
/// Permite distinguir "clic en el icono para cerrar" de "clic para abrir".
struct LastHide(Mutex<Option<Instant>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .manage(LastHide(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            quit,
            notes::list_notes,
            notes::load_note,
            notes::save_note,
            notes::create_note,
            notes::delete_note
        ])
        .setup(|app| {
            // La app vive solo en el menu bar: sin icono en el Dock.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;

            // Sin menú nativo: si el tray tiene un menú adjunto, macOS puede
            // quedarse los clics para mostrarlo y la ventana nunca se abre.
            // Cualquier clic (izquierdo o derecho) alterna el popover; salir
            // de la app se hace desde la propia UI (botón ⏻ o ⌘Q).
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
        .on_window_event(|window, event| {
            // Comportamiento de popover: se oculta al hacer clic fuera.
            if let tauri::WindowEvent::Focused(false) = event {
                if window.hide().is_ok() {
                    let state = window.state::<LastHide>();
                    *state.0.lock().unwrap() = Some(Instant::now());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar Notely");
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    // Si el popover acaba de ocultarse por el blur provocado por este mismo
    // clic en el icono, el usuario quería cerrarlo: no lo reabrimos.
    let state = app.state::<LastHide>();
    let just_hidden = state
        .0
        .lock()
        .unwrap()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(300));
    if just_hidden {
        return;
    }

    let _ = window.move_window(Position::TrayCenter);
    let _ = window.show();
    let _ = window.set_focus();
}
