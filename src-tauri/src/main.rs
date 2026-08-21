#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod display;
mod engine;
mod model;
mod schedule;

use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, State, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

use engine::Engine;
use model::{validate_settings, AppSettings, EngineStatus, Schedule};

static MAIN_WINDOW_CREATING: AtomicBool = AtomicBool::new(false);

fn build_main_window(app: &AppHandle) -> tauri::Result<()> {
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
    else {
        return Ok(());
    };
    let window = WebviewWindowBuilder::from_config(app, config)?.build()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    if MAIN_WINDOW_CREATING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        if app.get_webview_window("main").is_none() {
            let _ = build_main_window(&app);
        }
        MAIN_WINDOW_CREATING.store(false, Ordering::SeqCst);
    });
}

fn configure_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Redshift", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset", "Reset screen and pause", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Redshift", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &reset, &quit])?;
    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Redshift")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "reset" => {
                if let Some(engine) = app.try_state::<Engine>() {
                    let _ = engine.reset_and_disable();
                }
            }
            "quit" => {
                if let Some(engine) = app.try_state::<Engine>() {
                    engine.shutdown();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

#[tauri::command]
fn load_settings(engine: State<'_, Engine>) -> AppSettings {
    engine.settings()
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    engine: State<'_, Engine>,
    mut settings: AppSettings,
) -> Result<AppSettings, String> {
    for schedule in &mut settings.schedules {
        schedule.name = schedule.name.trim().to_string();
        schedule.effect = schedule.effect.normalized();
    }
    validate_settings(&settings)?;
    // A saved schedule must run even when the window was not opened that day.
    settings.run_at_login = true;
    app.autolaunch()
        .enable()
        .map_err(|error| format!("Could not enable background startup: {error}"))?;
    engine.set_settings(settings)
}

#[tauri::command]
fn preview_schedule(
    engine: State<'_, Engine>,
    schedule: Schedule,
    seconds: u64,
) -> Result<(), String> {
    if schedule.name.trim().is_empty() {
        return Err("Give this scene a name before previewing it.".into());
    }
    engine.preview(schedule, seconds);
    Ok(())
}

#[tauri::command]
fn stop_preview(engine: State<'_, Engine>) {
    engine.stop_preview();
}

#[tauri::command]
fn reset_screen(engine: State<'_, Engine>) -> Result<AppSettings, String> {
    engine.reset_and_disable()
}

#[tauri::command]
fn engine_status(engine: State<'_, Engine>) -> EngineStatus {
    engine.status()
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main_window(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            preview_schedule,
            stop_preview,
            reset_screen,
            engine_status,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.destroy();
            }
        })
        .setup(|app| {
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let settings = engine::load_settings(&settings_path);
            let _ = app.autolaunch().enable();
            let launch_hidden = std::env::args().any(|argument| argument == "--hidden");
            let engine = Engine::new(settings, settings_path);
            app.manage(engine.clone());
            engine.start();
            configure_tray(app.handle())?;
            if !launch_hidden {
                build_main_window(app.handle())?;
            }
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building Redshift");
    app.run(|app, event| match event {
        RunEvent::Resumed => {
            if let Some(engine) = app.try_state::<Engine>() {
                engine.refresh_now();
            }
        }
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        RunEvent::Exit => {
            if let Some(engine) = app.try_state::<Engine>() {
                engine.shutdown();
            }
            let _ = display::restore();
        }
        _ => {}
    });
}
