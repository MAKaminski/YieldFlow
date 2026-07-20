// YieldFlow Agent — Tauri v2 shell.
//
// Responsibilities:
//   1. Register the `yieldflow://` deep-link scheme (declared in tauri.conf.json).
//   2. When the OS hands us a `yieldflow://campaign/<id>` URL (from the website's
//      "Launch agent" button), extract the campaign id and run the bundled
//      Playwright sidecar, which opens the bank application and pre-fills it.
//
// NOTE: this is a scaffold. Tauri v2's deep-link + sidecar APIs move between
// minor versions; adjust to the exact crates you build against. The sidecar
// (../sidecar/run.mjs, packaged to binaries/yieldflow-sidecar) holds the actual
// browser-automation logic and is the part you iterate on.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn campaign_id_from_url(url: &str) -> Option<String> {
    // yieldflow://campaign/<id>
    url.strip_prefix("yieldflow://campaign/")
        .map(|s| s.trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
}

fn run_sidecar(app: &tauri::AppHandle, campaign_id: &str) {
    let app = app.clone();
    let campaign_id = campaign_id.to_string();
    tauri::async_runtime::spawn(async move {
        match app.shell().sidecar("yieldflow-sidecar") {
            Ok(cmd) => {
                let _ = cmd.arg(&campaign_id).spawn();
            }
            Err(e) => eprintln!("failed to launch sidecar: {e}"),
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Cold start: the app may have been launched via a deep link.
            if let Ok(urls) = app.deep_link().get_current() {
                if let Some(url) = urls.and_then(|u| u.into_iter().next()) {
                    if let Some(id) = campaign_id_from_url(url.as_str()) {
                        run_sidecar(&handle, &id);
                    }
                }
            }

            // Warm: subsequent deep links while already running.
            let handle2 = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(id) = campaign_id_from_url(url.as_str()) {
                        run_sidecar(&handle2, &id);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running YieldFlow Agent");
}
