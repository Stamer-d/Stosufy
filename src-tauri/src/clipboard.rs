// Files on the clipboard, as the file manager puts them there (Ctrl+C on a file): pasted into
// a chat, a mail or a folder they're those files. For what the file add-ons made, in
// ~/Stosufy (the page puts text and pictures on the clipboard itself).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use clipboard_rs::{Clipboard, ClipboardContext};
use tauri::{AppHandle, Manager, State};

/// The clipboard, kept: on Linux (X11) what's copied is there while it is
#[derive(Default)]
pub struct ClipboardState(Mutex<Option<ClipboardContext>>);

/// The files, if every one of them is in `root` (as real paths)
pub fn files_in(root: &Path, paths: &[String]) -> Result<Vec<PathBuf>, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if paths.is_empty() {
        return Err("Nothing to copy".into());
    }
    paths
        .iter()
        .map(|path| {
            let real = Path::new(path)
                .canonicalize()
                .map_err(|_| format!("{path} isn't there"))?;
            if !real.starts_with(&root) || !real.is_file() {
                return Err("Only what Stosufy made can be copied".into());
            }
            Ok(real)
        })
        .collect()
}

/// How the clipboard names a file here: its path, or (Linux) a file:// address
pub fn clipboard_name(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    if cfg!(any(windows, target_os = "macos")) {
        return text;
    }
    let mut uri = String::from("file://");
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => {
                uri.push(byte as char)
            }
            _ => uri.push_str(&format!("%{byte:02X}")),
        }
    }
    uri
}

#[tauri::command]
pub fn copy_files(
    app: AppHandle,
    state: State<'_, ClipboardState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let root = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join("Stosufy");
    let files = files_in(&root, &paths)?;
    let mut clipboard = state.0.lock().map_err(|e| e.to_string())?;
    if clipboard.is_none() {
        *clipboard = Some(ClipboardContext::new().map_err(|e| format!("No clipboard here: {e}"))?);
    }
    clipboard
        .as_ref()
        .unwrap()
        .set_files(files.iter().map(|file| clipboard_name(file)).collect())
        .map_err(|e| format!("Couldn't copy it: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn only_files_in_the_folder() {
        let root = std::env::temp_dir().join(format!("stosufy-clip-{}", std::process::id()));
        let inside = root.join("Converted");
        fs::create_dir_all(&inside).unwrap();
        let song = inside.join("My song (2).mp3");
        fs::write(&song, b"x").unwrap();
        let outside = std::env::temp_dir().join(format!("stosufy-clip-out-{}", std::process::id()));
        fs::write(&outside, b"x").unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();

        assert_eq!(files_in(&root, &[s(&song)]).unwrap().len(), 1);
        assert!(files_in(&root, &[s(&outside)]).is_err());
        assert!(files_in(
            &root,
            &[s(&inside
                .join("..")
                .join("..")
                .join(outside.file_name().unwrap()))]
        )
        .is_err());
        assert!(files_in(&root, &[s(&inside)]).is_err(), "a folder");
        assert!(files_in(&root, &[s(&inside.join("none.mp3"))]).is_err());
        assert!(files_in(&root, &[]).is_err());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn file_addresses() {
        assert_eq!(
            clipboard_name(Path::new("/home/a/Stosufy/Converted/My song (2) ä.mp3")),
            "file:///home/a/Stosufy/Converted/My%20song%20%282%29%20%C3%A4.mp3"
        );
    }

    /// On a desktop with X11 (skipped without one): what the clipboard holds is the file
    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn copies_on_x11() {
        if std::env::var_os("DISPLAY").is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("stosufy-x11-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a song.mp3");
        fs::write(&file, b"x").unwrap();
        let clipboard = ClipboardContext::new().unwrap();
        clipboard.set_files(vec![clipboard_name(&file)]).unwrap();
        let read = std::process::Command::new("xclip")
            .args(["-selection", "clipboard", "-o", "-t", "text/uri-list"])
            .output();
        let Ok(read) = read else { return };
        let uris = String::from_utf8_lossy(&read.stdout).into_owned();
        assert!(uris.contains("a%20song.mp3"), "{uris}");
        assert_eq!(clipboard.get_files().unwrap().len(), 1);
    }
}
