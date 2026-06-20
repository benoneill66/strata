pub mod ai;
mod commands;
pub mod export;
pub mod extract;
pub mod models;
pub mod pg;
pub mod secrets;
pub mod telemetry;

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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Persist settings (saved connections, prefs) under the OS app-data dir.
            let dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&dir).ok();
            let settings_path = dir.join("settings.json");
            let mut settings = std::fs::read_to_string(&settings_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
                .unwrap_or_default();
            // A non-empty password in the file is a pre-Keychain install:
            // move it over and rewrite the file stripped, one-time migration.
            // Do not hydrate every Keychain entry at launch; macOS prompts per
            // item and can make startup look like an authentication loop.
            let mut dirty = false;
            for c in &mut settings.connections {
                if !c.password.is_empty() && secrets::set(&c.id, &c.password).is_ok() {
                    c.password.clear();
                    dirty = true;
                }
            }
            // Mint a stable anonymous install id on first launch for telemetry.
            if settings.install_id.is_empty() {
                settings.install_id = uuid::Uuid::new_v4().to_string();
                dirty = true;
            }
            if dirty {
                if let Ok(json) = serde_json::to_string_pretty(&settings) {
                    let _ = std::fs::write(&settings_path, json);
                }
            }

            // Anonymous launch ping (off if disabled in Settings, DO_NOT_TRACK,
            // or a debug build). Fire-and-forget — never blocks startup.
            if telemetry::enabled(settings.telemetry_enabled) {
                telemetry::record_launch(settings.install_id.clone());
            }

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
            commands::list_all_tables,
            commands::table_columns,
            commands::schema_graph,
            commands::table_relations,
            commands::monitor_snapshot,
            commands::terminate_backend,
            commands::create_view,
            commands::server_logs,
            commands::table_rows,
            commands::table_count,
            commands::update_rows,
            commands::insert_row,
            commands::delete_row,
            commands::run_query,
            commands::export_table,
            commands::export_query,
            commands::export_related,
            commands::explain_query,
            commands::diagnose_plan,
            commands::ai_status,
            commands::generate_sql,
            commands::agent_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Strata")
}
