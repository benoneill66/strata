pub mod ai;
mod commands;
pub mod models;
pub mod pg;

use commands::AppState;
use models::Settings;
use parking_lot::RwLock;
use tauri::Manager;

#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Persist settings (saved connections, prefs) under the OS app-data dir.
            let dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&dir).ok();
            let settings_path = dir.join("settings.json");
            let settings = std::fs::read_to_string(&settings_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
                .unwrap_or_default();
            app.manage(AppState {
                settings: RwLock::new(settings),
                settings_path,
                pool: pg::Pool::new(),
            });

            // True native macOS glass: a thick NSVisualEffectView behind the
            // transparent webview (same HudWindow material as Cumulus/Sentinel).
            #[cfg(target_os = "macos")]
            if let Some(win) = app.get_webview_window("main") {
                let _ = apply_vibrancy(
                    &win,
                    NSVisualEffectMaterial::HudWindow,
                    Some(NSVisualEffectState::Active),
                    Some(18.0),
                );
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::test_connection,
            commands::connect_db,
            commands::switch_database,
            commands::list_databases,
            commands::disconnect_db,
            commands::connected_ids,
            commands::list_schemas,
            commands::list_tables,
            commands::table_columns,
            commands::table_rows,
            commands::table_count,
            commands::run_query,
            commands::ai_status,
            commands::generate_sql,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Strata")
}
