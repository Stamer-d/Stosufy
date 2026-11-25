// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by Claude as its connection to Stosufy (see mcp.rs): no window, just the
    // messages on stdin and stdout, handed to the app
    if std::env::args().any(|arg| arg == "--mcp") {
        stosufy_tauri_lib::mcp::run_bridge();
        return;
    }
    stosufy_tauri_lib::run()
}
