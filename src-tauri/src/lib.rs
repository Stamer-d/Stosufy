#[cfg(desktop)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Desktop only: on iOS there are no windows to restore, no updater (SideStore updates
    // it), no global shortcuts and no Discord
    #[cfg(desktop)]
    let builder = builder
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Remembers folders the user picked (e.g. the osu! Songs folder) across restarts
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_drpc::init())
        .plugin(tauri_plugin_prevent_default::debug());
    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_opener::init())
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
            // iOS: the music goes on with the screen locked and the silent switch on
            #[cfg(target_os = "ios")]
            play_in_background();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/** Tells iOS this app plays music (else it's muted by the silent switch and stops when locked) */
#[cfg(target_os = "ios")]
fn play_in_background() {
    use objc2_avf_audio::{AVAudioSession, AVAudioSessionCategoryPlayback};
    unsafe {
        let session = AVAudioSession::sharedInstance();
        if let Some(playback) = AVAudioSessionCategoryPlayback {
            if let Err(error) = session.setCategory_error(playback) {
                eprintln!("Could not set the audio session: {error:?}");
            }
        }
        let _ = session.setActive_error(true);
    }
}
