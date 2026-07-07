// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod notes;

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
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

            let quit = MenuItem::with_id(app, "quit", "Salir de Notely", true, Some("Cmd+Q"))?;
            let menu = Menu::with_items(app, &[&quit])?;

            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;

            TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("Notely")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
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

fn toggle_window(app: &tauri::AppHandle) {
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
