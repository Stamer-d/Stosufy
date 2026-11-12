// FFmpeg as a program of its own, for the file add-ons (converter, editor): many times faster
// than the one in WebAssembly, and without its memory limit. Not part of the installer: it's
// downloaded (once, ~20–30 MB) when it's first needed, from a pinned build whose SHA-256 is
// checked, and kept in the app's local data folder.
//
// It only works on files in its work folder (~/Stosufy/tmp/media), where the app puts what's
// to be converted: every input (-i) and the output have to be in there.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

/// The build there is for this computer: where it is, its SHA-256 (of the .gz) and its size
struct Build {
    url: &'static str,
    sha256: &'static str,
    size: u64,
}

pub const VERSION: &str = "6.1.1";

macro_rules! release {
    ($name:literal) => {
        concat!(
            "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/",
            $name
        )
    };
}

fn build() -> Option<Build> {
    let (url, sha256, size) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => (
            release!("ffmpeg-win32-x64.gz"),
            "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77",
            29_581_307,
        ),
        ("macos", "aarch64") => (
            release!("ffmpeg-darwin-arm64.gz"),
            "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa",
            19_246_198,
        ),
        ("macos", "x86_64") => (
            release!("ffmpeg-darwin-x64.gz"),
            "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106",
            25_296_431,
        ),
        ("linux", "x86_64") => (
            release!("ffmpeg-linux-x64.gz"),
            "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa",
            29_354_986,
        ),
        ("linux", "aarch64") => (
            release!("ffmpeg-linux-arm64.gz"),
            "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0",
            25_568_691,
        ),
        _ => return None,
    };
    Some(Build { url, sha256, size })
}

#[derive(Default)]
pub struct FfmpegState {
    /// What's running, by the id the page gave it (to stop it)
    running: Arc<Mutex<HashMap<String, Child>>>,
    installing: Mutex<bool>,
    /// Files the user chose (in the file picker): read where they are, not copied first
    picked: Mutex<HashSet<PathBuf>>,
}

impl FfmpegState {
    /// Stops everything (when the app closes: FFmpeg would go on without it)
    pub fn stop_all(&self) {
        if let Ok(mut running) = self.running.lock() {
            for (_, mut child) in running.drain() {
                let _ = child.kill();
            }
        }
    }
}

pub fn binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("ffmpeg")
        .join(VERSION)
        .join(name))
}

/// ~/Stosufy/tmp/media, made if it isn't there
/// What the file add-ons left in their work folders (copies, what FFmpeg or yt-dlp made and
/// wasn't saved: after a crash, or a file closed while it was worked on), taken away when the
/// app starts: nothing's working on them yet
pub fn clean_work_folders(app: &AppHandle) {
    let Ok(root) = stosufy_root(app) else { return };
    for folder in ["media", "downloads"] {
        let dir = root.join("tmp").join(folder);
        if dir.is_dir() {
            let _ = fs::remove_dir_all(&dir);
        }
    }
}

/// ~/Stosufy: what the add-ons made there (downloads, conversions) is read as it is
fn stosufy_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join("Stosufy"))
}

/// A file FFmpeg (and the page) may read: in ~/Stosufy, or one the user chose
fn readable(app: &AppHandle, state: &FfmpegState, path: &str) -> Result<bool, String> {
    Ok(inside(&stosufy_root(app)?, path)
        || is_picked(&*state.picked.lock().map_err(|e| e.to_string())?, path))
}

/// The file at `to` replaced by `from` (the old one to the system's trash first: nothing's lost
/// for good). `from`: what an add-on made, in ~/Stosufy; `to`: a file the user chose, or in
/// ~/Stosufy. Whether it worked, else why not.
pub fn replace_file(
    root: &Path,
    allowed: &dyn Fn(&str) -> bool,
    from: &str,
    to: &str,
) -> Result<(), String> {
    if !inside(root, from) || !Path::new(from).is_file() {
        return Err("Only what Stosufy made can take its place".into());
    }
    if !allowed(to) || !Path::new(to).is_file() {
        return Err("Only a file you chose here can be replaced".into());
    }
    trash::delete(to).map_err(|e| {
        format!("The original couldn't be put in the trash ({e}): it wasn't replaced")
    })?;
    // (moved; copied where it's on another drive)
    if fs::rename(from, to).is_err() {
        fs::copy(from, to).map_err(|e| format!("Couldn't put it there: {e}"))?;
        let _ = fs::remove_file(from);
    }
    Ok(())
}

#[tauri::command]
pub fn files_replace(
    app: AppHandle,
    state: State<'_, FfmpegState>,
    from: String,
    to: String,
) -> Result<(), String> {
    let root = stosufy_root(&app)?;
    let picked = state.picked.lock().map_err(|e| e.to_string())?.clone();
    replace_file(
        &root,
        &|path: &str| inside(&root, path) || is_picked(&picked, path),
        &from,
        &to,
    )
}

fn work_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join("Stosufy")
        .join("tmp")
        .join("media");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// There's a build for this computer
    supported: bool,
    installed: bool,
    version: &'static str,
    /// What's downloaded (bytes)
    download_size: u64,
    work_dir: String,
}

#[tauri::command]
pub fn ffmpeg_status(app: AppHandle) -> Result<Status, String> {
    let build = build();
    Ok(Status {
        supported: build.is_some(),
        installed: binary_path(&app)?.is_file(),
        version: VERSION,
        download_size: build.map(|b| b.size).unwrap_or(0),
        work_dir: work_dir(&app)?.to_string_lossy().into_owned(),
    })
}

#[derive(Clone, Serialize)]
struct InstallProgress {
    received: u64,
    total: u64,
}

/// Checks the download against its SHA-256 and unpacks it to `target` (made runnable)
pub fn verify_and_unpack(gz: &Path, sha256: &str, target: &Path) -> Result<(), String> {
    let mut hasher = Sha256::new();
    let mut file = File::open(gz).map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let hash = format!("{:x}", hasher.finalize());
    if hash != sha256 {
        return Err("The download isn't the expected file (its checksum differs)".into());
    }
    let part = target.with_extension("part");
    {
        let mut decoder = flate2::read::GzDecoder::new(File::open(gz).map_err(|e| e.to_string())?);
        let mut out = File::create(&part).map_err(|e| e.to_string())?;
        std::io::copy(&mut decoder, &mut out).map_err(|e| format!("Couldn't unpack it: {e}"))?;
        out.flush().map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&part, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    fs::rename(&part, target).map_err(|e| e.to_string())?;
    Ok(())
}

/// Downloads FFmpeg (once): progress as `ffmpeg-install` events. Returns where it is.
#[tauri::command]
pub async fn ffmpeg_install(
    app: AppHandle,
    state: State<'_, FfmpegState>,
) -> Result<String, String> {
    let target = binary_path(&app)?;
    if target.is_file() {
        return Ok(target.to_string_lossy().into_owned());
    }
    let build = build().ok_or("There's no FFmpeg for this computer")?;
    {
        let mut installing = state.installing.lock().map_err(|e| e.to_string())?;
        if *installing {
            return Err("It's being downloaded already".into());
        }
        *installing = true;
    }
    let result = download(&app, &build, &target).await;
    if let Ok(mut installing) = state.installing.lock() {
        *installing = false;
    }
    result.map(|_| target.to_string_lossy().into_owned())
}

async fn download(app: &AppHandle, build: &Build, target: &Path) -> Result<(), String> {
    let dir = target.parent().ok_or("no folder")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let gz = dir.join("download.gz");
    let mut response = reqwest::Client::new()
        .get(build.url)
        .send()
        .await
        .map_err(|e| format!("Couldn't download it: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't download it ({})", response.status()));
    }
    let total = response.content_length().unwrap_or(build.size);
    let mut file = File::create(&gz).map_err(|e| e.to_string())?;
    let mut received = 0u64;
    let mut reported = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("The download broke off: {e}"))?
    {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if received - reported > total / 100 {
            reported = received;
            let _ = app.emit("ffmpeg-install", InstallProgress { received, total });
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    let result = verify_and_unpack(&gz, build.sha256, target);
    let _ = fs::remove_file(&gz);
    result
}

/// Whether `path` is inside `dir` (both real paths; a new file: its folder)
fn inside(dir: &Path, path: &str) -> bool {
    let path = Path::new(path);
    if !path.is_absolute() {
        return false;
    }
    let real = match path.canonicalize() {
        Ok(real) => real,
        Err(_) => match (
            path.parent().and_then(|p| p.canonicalize().ok()),
            path.file_name(),
        ) {
            (Some(parent), Some(name)) => parent.join(name),
            _ => return false,
        },
    };
    dir.canonicalize()
        .map(|dir| real.starts_with(dir))
        .unwrap_or(false)
}

/// One of the files the user chose
fn is_picked(picked: &HashSet<PathBuf>, path: &str) -> bool {
    Path::new(path)
        .canonicalize()
        .map(|real| picked.contains(&real))
        .unwrap_or(false)
}

/// FFmpeg's output in the work folder, its inputs there or `readable` (chosen by the user, in
/// ~/Stosufy), nothing read from elsewhere
pub fn check_args(
    dir: &Path,
    readable: &dyn Fn(&str) -> bool,
    args: &[String],
) -> Result<(), String> {
    let output = args.last().ok_or("No output")?;
    if !inside(dir, output) {
        return Err("The output has to be in the work folder".into());
    }
    for pair in args.windows(2) {
        if pair[0] == "-i" && !inside(dir, &pair[1]) && !readable(&pair[1]) {
            return Err("The inputs have to be in the work folder".into());
        }
    }
    // (filters that read files of their own)
    if args
        .iter()
        .any(|arg| arg.contains("movie=") || arg.contains("sendcmd"))
    {
        return Err("That filter isn't allowed".into());
    }
    Ok(())
}

#[derive(Serialize, Debug)]
pub struct RunResult {
    code: i32,
    /// The end of what it said (its errors)
    log: String,
    cancelled: bool,
}

#[derive(Clone, Serialize)]
struct RunProgress {
    id: String,
    progress: f64,
}

fn command(binary: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(binary);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // (no console window popping up)
        command.creation_flags(0x0800_0000);
    }
    command
}

/// Runs FFmpeg with `args` (inputs and output in them), `progress` with 0–1 as it goes (of
/// `duration` seconds, if known)
pub fn run(
    binary: &Path,
    id: &str,
    args: &[String],
    duration: Option<f64>,
    running: &Mutex<HashMap<String, Child>>,
    mut progress: impl FnMut(f64),
) -> Result<RunResult, String> {
    let mut child = command(binary)
        .args([
            "-hide_banner",
            "-nostdin",
            "-y",
            "-loglevel",
            "error",
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't start FFmpeg: {e}"))?;
    let stdout = child.stdout.take().ok_or("no output")?;
    let stderr = child.stderr.take().ok_or("no output")?;
    running
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.to_string(), child);

    let errors = std::thread::spawn(move || {
        let mut lines: Vec<String> = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            lines.push(line);
            if lines.len() > 40 {
                lines.remove(0);
            }
        }
        lines.join("\n")
    });
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let (Some(time), Some(duration)) = (line.strip_prefix("out_time_us="), duration) {
            if let Ok(us) = time.trim().parse::<f64>() {
                if duration > 0.0 {
                    progress((us / 1e6 / duration).clamp(0.0, 1.0));
                }
            }
        }
    }
    let child = running.lock().map_err(|e| e.to_string())?.remove(id);
    let log = errors.join().unwrap_or_default();
    match child {
        Some(mut child) => {
            let status = child.wait().map_err(|e| e.to_string())?;
            Ok(RunResult {
                code: status.code().unwrap_or(-1),
                log,
                cancelled: false,
            })
        }
        // (taken out by ffmpeg_cancel, and killed)
        None => Ok(RunResult {
            code: -1,
            log,
            cancelled: true,
        }),
    }
}

#[tauri::command]
pub async fn ffmpeg_run(
    app: AppHandle,
    state: State<'_, FfmpegState>,
    id: String,
    args: Vec<String>,
    duration: Option<f64>,
) -> Result<RunResult, String> {
    let binary = binary_path(&app)?;
    if !binary.is_file() {
        return Err("FFmpeg isn't installed".into());
    }
    let root = stosufy_root(&app)?;
    {
        let picked = state.picked.lock().map_err(|e| e.to_string())?;
        check_args(
            &work_dir(&app)?,
            &|path: &str| inside(&root, path) || is_picked(&picked, path),
            &args,
        )?;
    }
    let running = state.running.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run(&binary, &id, &args, duration, &running, |progress| {
            let _ = app.emit(
                "ffmpeg-progress",
                RunProgress {
                    id: id.clone(),
                    progress,
                },
            );
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What FFmpeg says about a file (its streams and how long it is), as it says it
pub fn probe(binary: &Path, path: &str) -> Result<String, String> {
    let output = command(binary)
        .args(["-hide_banner", "-nostdin", "-i", path])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Couldn't start FFmpeg: {e}"))?;
    Ok(String::from_utf8_lossy(&output.stderr).into_owned())
}

#[tauri::command]
pub async fn ffmpeg_probe(
    app: AppHandle,
    state: State<'_, FfmpegState>,
    path: String,
) -> Result<String, String> {
    let binary = binary_path(&app)?;
    if !readable(&app, &state, &path)? && !inside(&work_dir(&app)?, &path) {
        return Err("The file has to be in the work folder".into());
    }
    tauri::async_runtime::spawn_blocking(move || probe(&binary, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ffmpeg_cancel(state: State<'_, FfmpegState>, id: String) -> Result<bool, String> {
    let child = state.running.lock().map_err(|e| e.to_string())?.remove(&id);
    Ok(match child {
        Some(mut child) => {
            let _ = child.kill();
            let _ = child.wait();
            true
        }
        None => false,
    })
}

#[derive(Serialize)]
pub struct Picked {
    path: String,
    name: String,
    size: u64,
}

/// Files chosen in the system's file picker: where they are (FFmpeg reads them there, the
/// player plays them from there), their names and sizes. None if it was closed.
#[tauri::command]
pub async fn files_pick(
    app: AppHandle,
    state: State<'_, FfmpegState>,
    multiple: bool,
) -> Result<Vec<Picked>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = app.dialog().file();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        if multiple {
            dialog.blocking_pick_files().unwrap_or_default()
        } else {
            dialog.blocking_pick_file().into_iter().collect()
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let mut picked = state.picked.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for file in chosen {
        let Ok(path) = file.into_path() else { continue };
        let Ok(real) = path.canonicalize() else {
            continue;
        };
        let Ok(meta) = fs::metadata(&real) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let _ = app.asset_protocol_scope().allow_file(&real);
        out.push(Picked {
            name: real
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: real.to_string_lossy().into_owned(),
            size: meta.len(),
        });
        picked.insert(real);
    }
    Ok(out)
}

/// A chosen file's bytes, or one in ~/Stosufy (a picture, a text: what the page reads itself)
#[tauri::command]
pub async fn files_read(
    app: AppHandle,
    state: State<'_, FfmpegState>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    if !readable(&app, &state, &path)? {
        return Err("Only a file that was chosen, or in Stosufy, can be read".into());
    }
    let data = tauri::async_runtime::spawn_blocking(move || fs::read(path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(data))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The FFmpeg of the computer the tests run on (they're skipped without one)
    fn system_ffmpeg() -> Option<PathBuf> {
        [
            "/usr/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
            "/opt/homebrew/bin/ffmpeg",
        ]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("stosufy-ffmpeg-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn s(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| part.to_string()).collect()
    }

    #[test]
    fn a_chosen_file_replaced() {
        let root = std::env::temp_dir().join(format!("stosufy-replace-{}", std::process::id()));
        let made = root.join("Edited");
        fs::create_dir_all(&made).unwrap();
        let new = made.join("song (edited).mp3");
        fs::write(&new, b"new").unwrap();
        let elsewhere =
            std::env::temp_dir().join(format!("stosufy-replace-out-{}", std::process::id()));
        fs::create_dir_all(&elsewhere).unwrap();
        let original = elsewhere.join("song.mp3");
        fs::write(&original, b"old").unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let chosen = original.canonicalize().unwrap();
        let allowed = |path: &str| Path::new(path).canonicalize().ok().as_ref() == Some(&chosen);
        // (not one that was chosen; not from outside ~/Stosufy)
        let other = elsewhere.join("other.mp3");
        fs::write(&other, b"other").unwrap();
        assert!(replace_file(&root, &allowed, &s(&new), &s(&other)).is_err());
        assert!(replace_file(&root, &allowed, &s(&other), &s(&original)).is_err());
        // (where there's a trash: the original in it, the new one in its place)
        match replace_file(&root, &allowed, &s(&new), &s(&original)) {
            Ok(()) => {
                assert_eq!(fs::read(&original).unwrap(), b"new");
                assert!(!new.exists());
            }
            Err(error) => {
                assert!(error.contains("wasn't replaced"), "{error}");
                assert_eq!(fs::read(&original).unwrap(), b"old");
            }
        }
    }

    #[test]
    fn only_the_work_folder() {
        let dir = temp_dir("args");
        let none = |_: &str| false;
        let inside_file = dir.join("in.wav");
        fs::write(&inside_file, b"x").unwrap();
        let input = inside_file.to_string_lossy().into_owned();
        let output = dir.join("out.mp3").to_string_lossy().into_owned();
        assert!(check_args(
            &dir,
            &none,
            &s(&["-i", &input, "-c:a", "libmp3lame", &output])
        )
        .is_ok());
        assert!(check_args(&dir, &none, &s(&["-i", "/etc/passwd", &output])).is_err());
        assert!(check_args(&dir, &none, &s(&["-i", &input, "/tmp/elsewhere.mp3"])).is_err());
        let sneaky = dir
            .join("..")
            .join("out.mp3")
            .to_string_lossy()
            .into_owned();
        assert!(check_args(&dir, &none, &s(&["-i", &input, &sneaky])).is_err());
        assert!(check_args(
            &dir,
            &none,
            &s(&["-i", "http://example.com/a.mp4", &output])
        )
        .is_err());
        assert!(check_args(
            &dir,
            &none,
            &s(&["-i", &input, "-vf", "movie=/etc/x", &output])
        )
        .is_err());
        assert!(check_args(&dir, &none, &s(&["-i", &input, "relative.mp3"])).is_err());
        // A file the user chose: read where it is (but still nothing written there)
        let elsewhere =
            std::env::temp_dir().join(format!("stosufy-picked-{}.wav", std::process::id()));
        fs::write(&elsewhere, b"x").unwrap();
        let chosen = elsewhere.to_string_lossy().into_owned();
        assert!(check_args(&dir, &none, &s(&["-i", &chosen, &output])).is_err());
        let real = elsewhere.canonicalize().unwrap();
        let picked = |path: &str| Path::new(path).canonicalize().ok().as_ref() == Some(&real);
        assert!(check_args(&dir, &picked, &s(&["-i", &chosen, &output])).is_ok());
        assert!(check_args(&dir, &picked, &s(&["-i", &input, &chosen])).is_err());
    }

    #[test]
    fn checks_the_download() {
        let dir = temp_dir("unpack");
        let gz = dir.join("x.gz");
        let mut encoder = flate2::write::GzEncoder::new(
            File::create(&gz).unwrap(),
            flate2::Compression::default(),
        );
        encoder.write_all(b"#!/bin/sh\necho hi\n").unwrap();
        encoder.finish().unwrap();
        let sha = format!("{:x}", Sha256::digest(fs::read(&gz).unwrap()));
        let target = dir.join("ffmpeg");
        assert!(verify_and_unpack(&gz, &"0".repeat(64), &target).is_err());
        assert!(!target.exists());
        verify_and_unpack(&gz, &sha, &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"#!/bin/sh\necho hi\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&target).unwrap().permissions().mode() & 0o777,
                0o755
            );
        }
    }

    #[test]
    fn every_platform_pinned() {
        if let Some(build) = build() {
            assert!(build.url.starts_with(
                "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/"
            ));
            assert_eq!(build.sha256.len(), 64);
        }
    }

    #[test]
    fn converts_with_progress_and_cancels() {
        let Some(ffmpeg) = system_ffmpeg() else {
            return;
        };
        let dir = temp_dir("run");
        let running = Mutex::new(HashMap::new());
        let input = dir.join("tone.wav").to_string_lossy().into_owned();
        let made = run(
            &ffmpeg,
            "make",
            &s(&["-f", "lavfi", "-i", "sine=frequency=440:duration=3", &input]),
            Some(3.0),
            &running,
            |_| {},
        )
        .unwrap();
        assert_eq!(made.code, 0, "{}", made.log);

        let info = probe(&ffmpeg, &input).unwrap();
        assert!(info.contains("Duration: 00:00:03"), "{info}");

        let output = dir.join("tone.mp3").to_string_lossy().into_owned();
        let mut seen = Vec::new();
        let result = run(
            &ffmpeg,
            "mp3",
            &s(&["-i", &input, "-c:a", "libmp3lame", "-b:a", "128k", &output]),
            Some(3.0),
            &running,
            |p| seen.push(p),
        )
        .unwrap();
        assert_eq!(result.code, 0, "{}", result.log);
        assert!(fs::metadata(&output).unwrap().len() > 10_000);
        assert!(seen.last().copied().unwrap_or(0.0) > 0.9, "{seen:?}");

        let failed = run(
            &ffmpeg,
            "bad",
            &s(&["-i", &dir.join("none.wav").to_string_lossy(), &output]),
            None,
            &running,
            |_| {},
        )
        .unwrap();
        assert_ne!(failed.code, 0);
        assert!(failed.log.contains("No such file"), "{}", failed.log);

        // Stopped while it runs: a long one, cancelled from another thread
        let running = Arc::new(Mutex::new(HashMap::new()));
        let stopper = running.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let child = stopper.lock().unwrap().remove("long");
            let mut child: Child = child.expect("it runs");
            child.kill().unwrap();
            let _ = child.wait();
        });
        let long = dir.join("long.wav").to_string_lossy().into_owned();
        let result = run(
            &ffmpeg,
            "long",
            &s(&["-re", "-f", "lavfi", "-i", "sine=duration=60", &long]),
            Some(60.0),
            &running,
            |_| {},
        )
        .unwrap();
        canceller.join().unwrap();
        assert!(result.cancelled);
    }
}
