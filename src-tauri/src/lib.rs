use tauri::Manager;

mod clipboard;
mod ffmpeg;
mod ytdlp;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second start hands over to the running app before anything else starts
        // (with the deep-link feature it passes on its link, e.g. the login or an invite)
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        // Remembers folders the user picked (e.g. the osu! Songs folder) across restarts
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_drpc::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_prevent_default::debug())
        .manage(ffmpeg::FfmpegState::default())
        .manage(clipboard::ClipboardState::default())
        .manage(ytdlp::YtdlpState::default())
        .invoke_handler(tauri::generate_handler![
            ffmpeg::ffmpeg_status,
            ffmpeg::ffmpeg_install,
            ffmpeg::ffmpeg_run,
            ffmpeg::ffmpeg_probe,
            ffmpeg::ffmpeg_cancel,
            ffmpeg::files_pick,
            ffmpeg::files_read,
            clipboard::copy_files,
            ytdlp::ytdlp_status,
            ytdlp::ytdlp_install,
            ytdlp::deno_install,
            ytdlp::ytdlp_info,
            ytdlp::ytdlp_download,
            ytdlp::ytdlp_cancel
        ])
        .setup(|app| {
            // The login link (stosufynew://) opens the app. On Linux this needs the desktop's
            // tools (xdg-utils): without them the app still starts, just without the link
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(error) = app.deep_link().register_all() {
                    eprintln!("Could not register the login link: {error}");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // (a conversion that's still running ends with the app)
            if let tauri::RunEvent::Exit = event {
                app.state::<ffmpeg::FfmpegState>().stop_all();
                app.state::<ytdlp::YtdlpState>().stop_all();
            }
        });
}
