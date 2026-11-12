// yt-dlp, for the downloader add-on: videos and their sound from YouTube, Twitch and the many
// other sites it knows, a part of them only if wanted. Not part of the installer: downloaded
// the first time it's needed, its SHA-256 checked against the release's list, and brought up
// to date (once a day, by the page) since the sites change all the time. YouTube also needs a
// JavaScript runtime (Deno, a pinned build, checked the same way), fetched with the first
// YouTube link. The merging and cutting is done by our own FFmpeg (ffmpeg.rs).
//
// The page doesn't hand it arguments: it says what it wants (DownloadRequest), and the
// arguments are made here, so nothing else can be run or read through it.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

const RELEASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
pub const DENO_VERSION: &str = "2.9.8";

/// yt-dlp for this computer: its release's ZIP of it unpacked (a program and its folder:
/// it starts at once, not unpacked again each time it runs, nor checked again by the virus
/// scanner), and the program's name in it
fn ytdlp_build() -> Option<(&'static str, &'static str)> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some(("yt-dlp_win.zip", "yt-dlp.exe")),
        ("macos", _) => Some(("yt-dlp_macos.zip", "yt-dlp_macos")),
        ("linux", "x86_64") => Some(("yt-dlp_linux.zip", "yt-dlp_linux")),
        ("linux", "aarch64") => Some(("yt-dlp_linux_aarch64.zip", "yt-dlp_linux_aarch64")),
        _ => None,
    }
}

macro_rules! deno_release {
    ($name:literal) => {
        concat!(
            "https://github.com/denoland/deno/releases/download/v2.9.8/",
            $name
        )
    };
}

/// Deno for this computer: where it is, its SHA-256 (of the .zip) and its size
fn deno_build() -> Option<(&'static str, &'static str, u64)> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => (
            deno_release!("deno-x86_64-pc-windows-msvc.zip"),
            "cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf",
            42_917_472,
        ),
        ("macos", "aarch64") => (
            deno_release!("deno-aarch64-apple-darwin.zip"),
            "9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e",
            38_770_795,
        ),
        ("macos", "x86_64") => (
            deno_release!("deno-x86_64-apple-darwin.zip"),
            "4b2f5edd2639b7470f034238b321d7002d8dfb4726d8558f52c17afac370eb2c",
            42_797_031,
        ),
        ("linux", "x86_64") => (
            deno_release!("deno-x86_64-unknown-linux-gnu.zip"),
            "e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609",
            41_963_064,
        ),
        ("linux", "aarch64") => (
            deno_release!("deno-aarch64-unknown-linux-gnu.zip"),
            "d49596c20b9788cf8f5d8ddf644103d4bde56ed239753f0bdb92ba9361d51905",
            40_120_596,
        ),
        _ => return None,
    })
}

#[derive(Default)]
pub struct YtdlpState {
    /// What's running, by the id the page gave it (to stop it)
    running: Arc<Mutex<HashMap<String, Child>>>,
    /// yt-dlp and Deno being downloaded (each on its own: one doesn't hold the other up)
    installing_ytdlp: AtomicBool,
    installing_deno: AtomicBool,
}

impl YtdlpState {
    pub fn stop_all(&self) {
        if let Ok(mut running) = self.running.lock() {
            for (_, child) in running.drain() {
                kill_tree(child);
            }
        }
    }
}

/// A download of a tool going on: its flag let go however it ends
struct Installing<'a>(&'a AtomicBool);

impl<'a> Installing<'a> {
    fn start(flag: &'a AtomicBool) -> Result<Self, String> {
        if flag.swap(true, Ordering::SeqCst) {
            return Err("It's being downloaded already".into());
        }
        Ok(Self(flag))
    }
}

impl Drop for Installing<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

const EXE: &str = if cfg!(windows) { ".exe" } else { "" };

fn tools_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

/// yt-dlp's folder (the versions in it, and `current`: the one used, and its ZIP's SHA-256)
fn ytdlp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(tools_dir(app)?.join("yt-dlp"))
}

/// The version used: its folder's name and its ZIP's SHA-256
fn current_ytdlp(dir: &Path) -> Option<(String, String)> {
    let text = fs::read_to_string(dir.join("current")).ok()?;
    let mut lines = text.lines();
    Some((
        lines.next()?.trim().to_string(),
        lines.next()?.trim().to_string(),
    ))
}

fn ytdlp_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = ytdlp_dir(app)?;
    let (_, program) = ytdlp_build().ok_or("There's no yt-dlp for this computer")?;
    Ok(match current_ytdlp(&dir) {
        Some((version, _)) => dir.join(version).join(program),
        // (none unpacked yet: the single file of before, if it's there)
        None => dir.join(format!("yt-dlp{EXE}")),
    })
}

fn deno_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(tools_dir(app)?
        .join("deno")
        .join(DENO_VERSION)
        .join(format!("deno{EXE}")))
}

/// The cookies file added (exported from a browser): a copy of it, in the app's own folder
fn cookies_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(tools_dir(app)?.join("cookies.txt"))
}

/// What a cookies file holds: how many cookies, and whether YouTube's are among them
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CookiesInfo {
    count: usize,
    youtube: bool,
    /// When it was added (Unix time, s)
    added: u64,
}

/// The cookies of a cookies.txt (the Netscape format browsers' extensions export: seven
/// fields a line, split by tabs); an error for anything else
pub fn read_cookies(text: &str) -> Result<(usize, bool), String> {
    let mut count = 0;
    let mut youtube = false;
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        // (#HttpOnly_ marks a cookie; other lines with # are comments)
        let line = line.strip_prefix("#HttpOnly_").unwrap_or(line);
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() != 7 {
            continue;
        }
        count += 1;
        let domain = fields[0].trim_start_matches('.');
        youtube |= domain == "youtube.com" || domain.ends_with(".youtube.com");
    }
    if count == 0 {
        let json = text.trim_start().starts_with('[') || text.trim_start().starts_with('{');
        return Err(if json {
            "That's cookies as JSON: export them as cookies.txt (Netscape format)".into()
        } else {
            "That's not a cookies file: export your cookies as cookies.txt (Netscape format)".into()
        });
    }
    Ok((count, youtube))
}

fn cookies_info_of(path: &Path) -> Option<CookiesInfo> {
    let text = fs::read_to_string(path).ok()?;
    let (count, youtube) = read_cookies(&text).ok()?;
    let added = fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| since.as_secs())
        .unwrap_or(0);
    Some(CookiesInfo {
        count,
        youtube,
        added,
    })
}

/// The cookies file added, if there's one
#[tauri::command]
pub fn cookies_info(app: AppHandle) -> Result<Option<CookiesInfo>, String> {
    Ok(cookies_info_of(&cookies_path(&app)?))
}

/// A cookies file chosen (exported from a browser) and kept: what's in it; None if none was
/// chosen
#[tauri::command]
pub async fn cookies_add(app: AppHandle) -> Result<Option<CookiesInfo>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = app
        .dialog()
        .file()
        .set_title("Your exported cookies (cookies.txt)")
        .add_filter("Cookies", &["txt"]);
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    if fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) > 20 * 1024 * 1024 {
        return Err("That file is too big for cookies".into());
    }
    let bytes = fs::read(&path).map_err(|e| format!("Couldn't read it: {e}"))?;
    read_cookies(&String::from_utf8_lossy(&bytes))?;
    let target = cookies_path(&app)?;
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&target, &bytes).map_err(|e| format!("Couldn't keep it: {e}"))?;
    Ok(cookies_info_of(&target))
}

/// The cookies file added: forgotten
#[tauri::command]
pub fn cookies_remove(app: AppHandle) -> Result<(), String> {
    let path = cookies_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// ~/Stosufy/tmp/downloads/<id>: where a download is made (the page then moves it)
fn download_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Not a download's id".into());
    }
    let dir = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join("Stosufy")
        .join("tmp")
        .join("downloads")
        .join(id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    supported: bool,
    installed: bool,
    deno_supported: bool,
    deno_installed: bool,
    /// What's downloaded (bytes, about)
    download_size: u64,
    deno_size: u64,
}

#[tauri::command]
pub fn ytdlp_status(app: AppHandle) -> Result<Status, String> {
    Ok(Status {
        supported: ytdlp_build().is_some(),
        installed: ytdlp_path(&app)?.is_file(),
        deno_supported: deno_build().is_some(),
        deno_installed: deno_path(&app)?.is_file(),
        download_size: 40_000_000,
        deno_size: deno_build().map(|(_, _, size)| size).unwrap_or(0),
    })
}

#[derive(Clone, Serialize)]
struct InstallProgress {
    what: &'static str,
    received: u64,
    total: u64,
}

fn client() -> Result<reqwest::Client, String> {
    crate::fetch::client()
}

/// Downloads `url` to `to` (in pieces at once; progress as `ytdlp-install` events); its SHA-256
async fn fetch(
    app: &AppHandle,
    what: &'static str,
    url: &str,
    to: &Path,
    size: u64,
) -> Result<String, String> {
    let app = app.clone();
    let progress = crate::fetch::every_percent(move |received, total| {
        let _ = app.emit(
            "ytdlp-install",
            InstallProgress {
                what,
                received,
                total,
            },
        );
    });
    crate::fetch::fetch(url, to, size, progress).await
}

fn make_runnable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    let _ = path;
    Ok(())
}

/// The SHA-256 of `asset` in a release's SHA2-256SUMS
pub fn sum_for(sums: &str, asset: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == asset && hash.len() == 64).then(|| hash.to_ascii_lowercase())
    })
}

/// yt-dlp downloaded, or brought up to date: "installed", "updated", "current", or "busy"
/// (a download or lookup runs: its program can't be replaced under it, on Windows)
#[tauri::command]
pub async fn ytdlp_install(app: AppHandle, state: State<'_, YtdlpState>) -> Result<String, String> {
    let (asset, _) = ytdlp_build().ok_or("There's no yt-dlp for this computer")?;
    let _installing = Installing::start(&state.installing_ytdlp)?;
    let busy = !state.running.lock().map_err(|e| e.to_string())?.is_empty();
    if busy && ytdlp_path(&app)?.is_file() {
        return Ok("busy".into());
    }
    install_ytdlp(&app, asset).await
}

async fn install_ytdlp(app: &AppHandle, asset: &str) -> Result<String, String> {
    let (_, program) = ytdlp_build().ok_or("There's no yt-dlp for this computer")?;
    let dir = ytdlp_dir(app)?;
    let response = client()?
        .get(format!("{RELEASE}SHA2-256SUMS"))
        .send()
        .await
        .map_err(|e| format!("Couldn't check for yt-dlp: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't check for yt-dlp ({})", response.status()));
    }
    let sums = response.text().await.map_err(|e| e.to_string())?;
    let wanted = sum_for(&sums, asset).ok_or("yt-dlp's release has no file for this computer")?;
    let had = current_ytdlp(&dir);
    if let Some((version, sum)) = &had {
        if *sum == wanted && dir.join(version).join(program).is_file() {
            return Ok("current".into());
        }
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let zip = dir.join("download.zip");
    let fetched = fetch(
        app,
        "yt-dlp",
        &format!("{RELEASE}{asset}"),
        &zip,
        25_000_000,
    )
    .await;
    let version = wanted[..16].to_string();
    let unpacked = dir.join(format!("{version}.part"));
    let result = match fetched {
        Ok(hash) if hash == wanted => {
            let _ = fs::remove_dir_all(&unpacked);
            unzip_all(&zip, &unpacked).and_then(|_| make_runnable(&unpacked.join(program)))
        }
        Ok(_) => Err("The download isn't the expected file (its checksum differs)".into()),
        Err(error) => Err(error),
    };
    let _ = fs::remove_file(&zip);
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&unpacked);
        return Err(error);
    }
    let _ = fs::remove_dir_all(dir.join(&version));
    fs::rename(&unpacked, dir.join(&version)).map_err(|e| e.to_string())?;
    // (the current one named: written aside, then put in place at once)
    let pointer = dir.join("current.part");
    fs::write(&pointer, format!("{version}\n{wanted}\n")).map_err(|e| e.to_string())?;
    fs::rename(&pointer, dir.join("current")).map_err(|e| e.to_string())?;
    // The ones before (and the single file of before): gone, where nothing runs them
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == version || name == "current" {
                continue;
            }
            if path.is_dir() {
                let _ = fs::remove_dir_all(&path);
            } else {
                let _ = fs::remove_file(&path);
            }
        }
    }
    Ok(if had.is_some() {
        "updated"
    } else {
        "installed"
    }
    .into())
}

/// A whole ZIP unpacked into `target` (nothing out of it: names that would lead elsewhere are
/// left out), each file as runnable as it was
pub fn unzip_all(zip: &Path, target: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(File::open(zip).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Couldn't unpack it: {e}"))?;
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let path = target.join(name);
        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = File::create(&path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("Couldn't unpack it: {e}"))?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(mode & 0o777));
        }
    }
    Ok(())
}

/// The runtime for YouTube's challenges, downloaded (once)
#[tauri::command]
pub async fn deno_install(app: AppHandle, state: State<'_, YtdlpState>) -> Result<(), String> {
    let target = deno_path(&app)?;
    if target.is_file() {
        return Ok(());
    }
    let (url, sha, size) = deno_build().ok_or("There's no Deno for this computer")?;
    let _installing = Installing::start(&state.installing_deno)?;
    let dir = target.parent().ok_or("no folder")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let zip = dir.join("download.zip");
    let result = match fetch(&app, "deno", url, &zip, size).await {
        Ok(hash) if hash == sha => unzip_one(&zip, &format!("deno{EXE}"), &target),
        Ok(_) => Err("The download isn't the expected file (its checksum differs)".into()),
        Err(error) => Err(error),
    };
    let _ = fs::remove_file(&zip);
    result
}

/// The file `name` out of a ZIP, to `target` (made runnable)
pub fn unzip_one(zip: &Path, name: &str, target: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(File::open(zip).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mut entry = archive
        .by_name(name)
        .map_err(|_| format!("{name} isn't in the download"))?;
    let part = target.with_extension("part");
    let mut out = File::create(&part).map_err(|e| e.to_string())?;
    std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    make_runnable(&part)?;
    fs::rename(&part, target).map_err(|e| e.to_string())
}

/// What the page wants downloaded
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    /// "video" or "audio"
    pub kind: String,
    /// A video's container (mp4, webm, mkv), or the sound's format (mp3, m4a, opus, flac, wav,
    /// or "original": as it is, not made again)
    pub format: String,
    /// A video's codec: h264, vp9, av1, hevc, or any (the best there is)
    #[serde(default)]
    pub codec: Option<String>,
    /// At most this many lines high (none: the best there is)
    pub height: Option<u32>,
    /// The sound's kbit/s (none: the best)
    #[serde(default)]
    pub audio_kbps: Option<u32>,
    /// Only these parts (s, from–to)
    #[serde(default)]
    pub sections: Vec<[f64; 2]>,
    /// The parts cut exactly (a re-encode at the cuts)
    #[serde(default)]
    pub exact_cuts: bool,
    /// Sponsors and the like taken out (YouTube's SponsorBlock)
    #[serde(default)]
    pub sponsorblock: bool,
    /// The playlist (else just the video), and which of its videos ("1-10"; none: all)
    #[serde(default)]
    pub playlist: bool,
    #[serde(default)]
    pub playlist_items: Option<String>,
    /// Signed in as in this browser
    pub cookies: Option<String>,
}

const BROWSERS: [&str; 9] = [
    "brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale",
];
const KBPS: [u32; 6] = [96, 128, 160, 192, 256, 320];
/// Signed in with the cookies file added (instead of a browser's name)
pub const COOKIES_FILE: &str = "file";

/// A link to a page (nothing that would be read as an option, a file or another protocol)
pub fn check_url(url: &str) -> Result<(), String> {
    let ok = (url.starts_with("https://") || url.starts_with("http://"))
        && url.len() < 4096
        && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    ok.then_some(()).ok_or_else(|| "That's not a link".into())
}

fn check_browser(cookies: &Option<String>) -> Result<(), String> {
    match cookies {
        // (the cookies file added: see cookies_add)
        Some(file) if file == COOKIES_FILE => Ok(()),
        Some(browser) if !BROWSERS.contains(&browser.as_str()) => {
            Err("Not a browser it knows".into())
        }
        _ => Ok(()),
    }
}

/// What every run gets: no configuration, plugins or updates of its own, UTF-8, our FFmpeg,
/// Deno for YouTube, the browser's sign-in
pub fn common_args(
    ffmpeg: &Path,
    deno: Option<&Path>,
    cookies: &Option<String>,
    cookies_file: &Path,
) -> Vec<String> {
    let mut args: Vec<String> = [
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-update",
        "--encoding",
        "utf-8",
        "--color",
        "never",
        "--ffmpeg-location",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.push(ffmpeg.to_string_lossy().into_owned());
    if let Some(deno) = deno {
        args.push("--js-runtimes".into());
        args.push(format!("deno:{}", deno.to_string_lossy()));
    }
    match cookies.as_deref() {
        Some(COOKIES_FILE) => {
            args.push("--cookies".into());
            args.push(cookies_file.to_string_lossy().into_owned());
        }
        Some(browser) => {
            args.push("--cookies-from-browser".into());
            args.push(browser.to_string());
        }
        None => {}
    }
    args
}

fn seconds(value: f64) -> String {
    format!("{:.3}", value)
}

/// yt-dlp's format filter for a video codec
fn codec_filter(codec: &str) -> Result<&'static str, String> {
    Ok(match codec {
        "h264" => "[vcodec~='^(avc|h264)']",
        "vp9" => "[vcodec~='^vp0?9']",
        "av1" => "[vcodec~='^av01']",
        "hevc" => "[vcodec~='^(hev|hvc|h265)']",
        "any" => "",
        _ => return Err("Not a codec it knows".into()),
    })
}

/// The progress it writes: how far, how fast, how long still, which video of a playlist (of
/// how many), and whether it's the picture or the sound
pub const PROGRESS: &str = "download:[dl] %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(info.playlist_index|)s|%(info.playlist_count|)s|%(info.vcodec|)s";

/// H.264 made on the processor: fast, at a high quality (what's used without a graphics card's)
pub fn software_encoder() -> Vec<String> {
    [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// The graphics card's H.264 encoders there may be, the likeliest first
fn hardware_encoders() -> Vec<Vec<&'static str>> {
    let mut all: Vec<Vec<&'static str>> = Vec::new();
    if cfg!(target_os = "macos") {
        all.push(vec![
            "-c:v",
            "h264_videotoolbox",
            "-q:v",
            "65",
            "-pix_fmt",
            "yuv420p",
        ]);
    } else {
        all.push(vec![
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p4",
            "-rc",
            "vbr",
            "-cq",
            "19",
            "-b:v",
            "0",
            "-pix_fmt",
            "yuv420p",
        ]);
        all.push(vec![
            "-c:v",
            "h264_qsv",
            "-global_quality",
            "20",
            "-pix_fmt",
            "nv12",
        ]);
        if cfg!(windows) {
            all.push(vec![
                "-c:v", "h264_amf", "-quality", "balanced", "-pix_fmt", "nv12",
            ]);
        }
    }
    all
}

/// Whether FFmpeg can make half a second of video with these (in at most 10 s)
fn encodes(ffmpeg: &Path, encoder: &[&str]) -> bool {
    let mut command = Command::new(ffmpeg);
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x240:r=30:d=0.5",
        ])
        .args(encoder)
        .args(["-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let Ok(mut child) = command.spawn() else {
        return false;
    };
    for _ in 0..100 {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => return false,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    false
}

/// The graphics card's encoder failed on a real video: the processor's from now on
static HARDWARE_FAILED: AtomicBool = AtomicBool::new(false);
static FAST_ENCODER: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();

/// The fastest H.264 encoder that works here: the graphics card's, else the processor's
/// (found once: each is tried on half a second of video)
pub fn fast_encoder(ffmpeg: &Path) -> Vec<String> {
    if HARDWARE_FAILED.load(Ordering::Relaxed) {
        return software_encoder();
    }
    FAST_ENCODER
        .get_or_init(|| {
            hardware_encoders()
                .into_iter()
                .find(|encoder| encodes(ffmpeg, encoder))
                .map(|encoder| encoder.iter().map(|s| s.to_string()).collect())
                .unwrap_or_else(software_encoder)
        })
        .clone()
}

/// yt-dlp's arguments for a download into `out` (checked: only what's offered)
pub fn download_args(
    request: &DownloadRequest,
    out: &Path,
    encoder: &[String],
) -> Result<Vec<String>, String> {
    check_url(&request.url)?;
    check_browser(&request.cookies)?;
    let mut args: Vec<String> = Vec::new();
    let mut push = |items: &[&str]| args.extend(items.iter().map(|s| s.to_string()));
    push(&[
        "--newline",
        "--progress",
        "--progress-template",
        PROGRESS,
        "--progress-template",
        "postprocess:[pp] %(progress.postprocessor)s",
        "-O",
        "after_move:[done] %(filepath)s",
        "-o",
        // (a playlist's videos numbered: two of the same title don't take each other's name)
        if request.playlist {
            "%(playlist_index)03d %(title).140B.%(ext)s"
        } else {
            "%(title).150B.%(ext)s"
        },
        "--windows-filenames",
        "--no-mtime",
        "--embed-metadata",
        // (a stream in many pieces, Twitch's, YouTube's live ones: four of them at once)
        "--concurrent-fragments",
        "4",
    ]);
    let height = match request.height {
        // (any a video has: 800p, a phone's upright 1920, …)
        Some(h) if (100..=8640).contains(&h) => format!("[height<={h}]"),
        Some(_) => return Err("Not a size it knows".into()),
        None => String::new(),
    };
    match (request.kind.as_str(), request.format.as_str()) {
        ("video", container @ ("mp4" | "webm" | "mkv")) => {
            let codec = codec_filter(request.codec.as_deref().unwrap_or("any"))?;
            // (the sound that goes with the container: AAC in an MP4, Opus in a WebM)
            let sound = match container {
                "mp4" => "(ba[acodec^=mp4a]/ba)",
                "webm" => "(ba[acodec=opus]/ba)",
                _ => "ba",
            };
            // That codec at most that high, else any codec at most that high, else the best
            let selector = format!("bv*{codec}{height}+{sound}/bv*{height}+ba/b{height}/bv*+ba/b");
            push(&["-f", &selector]);
            // (a WebM holds only VP9/AV1 and Opus: what's in another codec, where a video has
            // no VP9, as MKV instead of failing)
            let (merge, remux) = match container {
                "webm" => ("webm/mkv", "webm>webm/mkv"),
                other => (other, other),
            };
            push(&["--merge-output-format", merge, "--remux-video", remux]);
            push(&["--embed-chapters"]);
            // (WebM holds no cover picture)
            if container != "webm" {
                push(&["--embed-thumbnail"]);
            }
        }
        ("audio", format @ ("original" | "mp3" | "m4a" | "opus" | "flac" | "wav")) => {
            // The sound that's already in that format, where there's one: not made again
            let selector = match format {
                "m4a" => "ba[acodec^=mp4a]/ba/b",
                "opus" => "ba[acodec=opus]/ba/b",
                _ => "ba/b",
            };
            let quality = match request.audio_kbps {
                Some(k) if KBPS.contains(&k) => format!("{k}K"),
                Some(_) => return Err("Not a bitrate it knows".into()),
                None => "0".into(),
            };
            let target = if format == "original" { "best" } else { format };
            push(&[
                "-f",
                selector,
                "-x",
                "--audio-format",
                target,
                "--audio-quality",
                &quality,
            ]);
            if format != "wav" {
                push(&["--embed-thumbnail"]);
            }
        }
        _ => return Err("Not a format it knows".into()),
    }
    for [from, to] in &request.sections {
        if !from.is_finite() || !to.is_finite() || *from < 0.0 || to <= from {
            return Err("Not a part of it".into());
        }
        let section = format!("*{}-{}", seconds(*from), seconds(*to));
        push(&["--download-sections", &section]);
    }
    // Cut exactly (a video's picture made again where it's cut: with the fastest encoder there
    // is, at a high quality); else the streams as they are, cut at the keyframes (fast, and as
    // good as the original). Sound is cut exactly as it is.
    if !request.sections.is_empty() && request.exact_cuts && request.kind == "video" {
        push(&["--force-keyframes-at-cuts"]);
        let output = if request.format == "webm" {
            "-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1 -crf 30 -b:v 0 -c:a libopus -b:a 160k"
                .to_string()
        } else {
            format!("{} -c:a aac -b:a 192k", encoder.join(" "))
        };
        push(&["--downloader-args", &format!("ffmpeg_o:{output}")]);
    }
    if request.sponsorblock {
        // (sponsors, self-promotion and "subscribe!": not intros, recaps or previews, which can be
        // the video itself)
        push(&["--sponsorblock-remove", "sponsor,selfpromo,interaction"]);
    }
    if request.playlist {
        push(&["--yes-playlist"]);
        if let Some(items) = &request.playlist_items {
            let ok = !items.is_empty()
                && items.len() < 64
                && items
                    .chars()
                    .all(|c| c.is_ascii_digit() || matches!(c, ',' | '-' | ':'));
            if !ok {
                return Err("Not a choice of videos it knows".into());
            }
            push(&["-I", items]);
        }
    } else {
        push(&["--no-playlist"]);
    }
    push(&["-P"]);
    args.push(out.to_string_lossy().into_owned());
    args.push("--".into());
    args.push(request.url.clone());
    Ok(args)
}

fn command(binary: &Path) -> Command {
    let mut command = Command::new(binary);
    // (its output in UTF-8: the names of the files it made, whatever their letters)
    command
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8");
    #[cfg(unix)]
    {
        // (a group of its own: stopped with what it starts, FFmpeg for a part of a video)
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

/// Stops it and everything it started (FFmpeg cutting a part keeps going without that)
fn kill_tree(mut child: Child) {
    let pid = child.id().to_string();
    #[cfg(unix)]
    {
        // (its group: it and all it started, as it was started in a group of its own)
        if let Ok(group) = pid.parse::<i32>() {
            unsafe {
                libc::killpg(group, libc::SIGKILL);
            }
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .creation_flags(0x0800_0000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = pid;
    let _ = child.kill();
    let _ = child.wait();
}

/// What a run ended with: its code, the end of what it said on stderr, whether it was stopped
pub struct Ended {
    pub code: i32,
    pub log: String,
    pub cancelled: bool,
}

/// Runs yt-dlp, each line of its output to `line`
pub fn run(
    binary: &Path,
    id: &str,
    args: &[String],
    running: &Mutex<HashMap<String, Child>>,
    mut line: impl FnMut(&str),
) -> Result<Ended, String> {
    let mut child = command(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't start yt-dlp: {e}"))?;
    let stdout = child.stdout.take().ok_or("no output")?;
    let stderr = child.stderr.take().ok_or("no output")?;
    running
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.to_string(), child);
    // (both of its outputs, as they come: its progress is on one, what it does after on the
    // other; a line that isn't UTF-8 read as well as it can be, not the end of it)
    let (send, lines) = std::sync::mpsc::channel::<(bool, String)>();
    let readers = [
        (false, Box::new(stdout) as Box<dyn Read + Send>),
        (true, Box::new(stderr)),
    ]
    .into_iter()
    .map(|(is_error, stream)| {
        let send = send.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut bytes = Vec::new();
            loop {
                bytes.clear();
                match reader.read_until(b'\n', &mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let text = String::from_utf8_lossy(&bytes)
                            .trim_end_matches(['\r', '\n'])
                            .to_string();
                        if send.send((is_error, text)).is_err() {
                            break;
                        }
                    }
                }
            }
        })
    })
    .collect::<Vec<_>>();
    drop(send);
    let mut errors: Vec<String> = Vec::new();
    for (is_error, text) in lines {
        line(&text);
        if is_error {
            errors.push(text);
            if errors.len() > 40 {
                errors.remove(0);
            }
        }
    }
    for reader in readers {
        let _ = reader.join();
    }
    let child = running.lock().map_err(|e| e.to_string())?.remove(id);
    let log = errors.join("\n");
    match child {
        Some(mut child) => {
            let status = child.wait().map_err(|e| e.to_string())?;
            Ok(Ended {
                code: status.code().unwrap_or(-1),
                log,
                cancelled: false,
            })
        }
        None => Ok(Ended {
            code: -1,
            log,
            cancelled: true,
        }),
    }
}

/// What it says went wrong, in a line
pub fn explain(log: &str) -> String {
    let said = log
        .lines()
        .rev()
        .find(|line| line.starts_with("ERROR:"))
        .map(|line| line.trim_start_matches("ERROR:").trim().to_string());
    let Some(said) = said else {
        return "It couldn't be downloaded".into();
    };
    let lower = said.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|word| lower.contains(word));
    if has(&[
        "could not copy chrome cookie",
        "could not find",
        "cookie database",
        "dpapi",
        "app-bound",
        "failed to decrypt",
    ]) {
        return "Your browser's sign-in couldn't be read: close the browser and try again, or choose Firefox".into();
    }
    if has(&[
        "cookies are no longer valid",
        "cookies file",
        "netscape format",
    ]) {
        return "The cookies file is out of date or broken: export it again and add it".into();
    }
    if has(&["full disk access", "operation not permitted"]) && lower.contains("cookie") {
        return "Safari's sign-in can't be read without Full Disk Access for Stosufy (in the system settings)".into();
    }
    if has(&[
        "sign in to confirm",
        "login required",
        "members-only",
        "this video is only available for registered users",
        "age",
    ]) && has(&[
        "sign in",
        "login",
        "members",
        "registered",
        "age-restricted",
        "confirm your age",
    ]) {
        return "This needs you to be signed in: choose your browser under \"Signed in\"".into();
    }
    if has(&["private video"]) {
        return "This video is private".into();
    }
    if has(&[
        "video unavailable",
        "has been removed",
        "not available in your country",
        "geo restrict",
    ]) {
        return "This video isn't available (removed, or not here)".into();
    }
    if has(&["unsupported url"]) {
        return "This site isn't one it can download from".into();
    }
    if has(&["http error 429", "too many requests"]) {
        return "The site says too many downloads at once: wait a bit and try again".into();
    }
    if has(&["http error 403", "forbidden"]) {
        return "The site refused it (403): try again, or sign in with your browser".into();
    }
    if has(&["http error 404", "not found"]) {
        return "There's nothing at that link (404)".into();
    }
    if has(&[
        "getaddrinfo",
        "name or service not known",
        "nodename nor servname",
        "network is unreachable",
        "timed out",
        "connection refused",
    ]) {
        return "The site couldn't be reached: are you online?".into();
    }
    if has(&["requested format is not available"]) {
        return "That quality isn't there for this video: choose another".into();
    }
    said.replace(" (caused by", " (")
        .chars()
        .take(300)
        .collect()
}

fn runtime(app: &AppHandle) -> Result<(PathBuf, PathBuf, Option<PathBuf>), String> {
    let binary = ytdlp_path(app)?;
    if !binary.is_file() {
        return Err("yt-dlp isn't installed".into());
    }
    let ffmpeg = crate::ffmpeg::binary_path(app)?;
    if !ffmpeg.is_file() {
        return Err("FFmpeg isn't installed".into());
    }
    let deno = deno_path(app)?;
    Ok((binary, ffmpeg, deno.is_file().then_some(deno)))
}

/// What a link is: a video's (or a playlist's) information, as yt-dlp's JSON
#[tauri::command]
pub async fn ytdlp_info(
    app: AppHandle,
    state: State<'_, YtdlpState>,
    id: String,
    url: String,
    cookies: Option<String>,
) -> Result<String, String> {
    check_url(&url)?;
    check_browser(&cookies)?;
    let (binary, ffmpeg, deno) = runtime(&app)?;
    let mut args = common_args(&ffmpeg, deno.as_deref(), &cookies, &cookies_path(&app)?);
    args.extend(
        [
            "-J",
            "--no-playlist",
            "--flat-playlist",
            "--no-warnings",
            "--",
            &url,
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    let running = state.running.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut json = String::new();
        let ended = run(&binary, &id, &args, &running, |line| {
            if !line.starts_with('[') || line.starts_with("[{") {
                json.push_str(line);
                json.push('\n');
            }
        })?;
        if ended.cancelled {
            return Err("Stopped".into());
        }
        if ended.code != 0 || json.trim().is_empty() {
            return Err(explain(&ended.log));
        }
        Ok(json)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    id: String,
    /// "download", or what's done after it (Merger, ExtractAudio, …)
    phase: String,
    percent: Option<f64>,
    speed: Option<String>,
    eta: Option<String>,
    /// Which of a playlist's videos (and of how many)
    index: Option<u32>,
    count: Option<u32>,
    /// "video" or "audio": what's downloaded now (of a video downloaded as two)
    stream: Option<String>,
}

#[derive(Serialize)]
pub struct DownloadedFile {
    path: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloaded {
    /// The files made (in ~/Stosufy/tmp/downloads/<id>)
    files: Vec<DownloadedFile>,
    cancelled: bool,
    /// What went wrong with some of them (a playlist's private videos, …)
    error: Option<String>,
}

/// What a line of a download's output says: its progress, or a file made
pub fn read_line(line: &str) -> (Option<Progress>, Option<String>) {
    if let Some(rest) = line.strip_prefix("[dl] ") {
        let parts: Vec<&str> = rest.split('|').map(str::trim).collect();
        let part = |i: usize| {
            parts
                .get(i)
                .copied()
                .filter(|s| !s.is_empty() && *s != "NA")
        };
        let known = |i: usize| part(i).filter(|s| !s.contains("Unknown")).map(String::from);
        let number = |i: usize| part(i).and_then(|s| s.parse::<u32>().ok());
        let progress = Progress {
            phase: "download".into(),
            percent: part(0).and_then(|p| p.trim_end_matches('%').trim().parse::<f64>().ok()),
            speed: known(1),
            eta: known(2),
            index: number(3),
            count: number(4),
            stream: part(5).map(|codec| if codec == "none" { "audio" } else { "video" }.into()),
            ..Default::default()
        };
        return (Some(progress), None);
    }
    if let Some(step) = line.strip_prefix("[pp] ") {
        let progress = Progress {
            phase: step.trim().to_string(),
            ..Default::default()
        };
        return (Some(progress), None);
    }
    if let Some(path) = line.strip_prefix("[done] ") {
        return (None, Some(path.trim().to_string()));
    }
    (None, None)
}

const MEDIA: [&str; 14] = [
    "mp4", "mkv", "webm", "mov", "m4a", "mp3", "opus", "ogg", "flac", "wav", "aac", "m4v", "ts",
    "flv",
];

/// The media files in a folder, the biggest first (what's there when it didn't say)
fn media_in(dir: &Path) -> Vec<String> {
    let mut found: Vec<(u64, String)> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let ext = path.extension()?.to_string_lossy().to_lowercase();
            let meta = entry.metadata().ok()?;
            (meta.is_file() && MEDIA.contains(&ext.as_str()))
                .then(|| (meta.len(), path.to_string_lossy().into_owned()))
        })
        .collect();
    found.sort_by_key(|b| std::cmp::Reverse(b.0));
    found.into_iter().map(|(_, path)| path).collect()
}

#[tauri::command]
pub async fn ytdlp_download(
    app: AppHandle,
    state: State<'_, YtdlpState>,
    id: String,
    request: DownloadRequest,
) -> Result<Downloaded, String> {
    let (binary, ffmpeg, deno) = runtime(&app)?;
    let out = download_dir(&app, &id)?;
    let cookies_file = cookies_path(&app)?;
    // (checked now: what's asked for, before anything runs)
    download_args(&request, &out, &software_encoder())?;
    let running = state.running.clone();
    let playlist = request.playlist;
    let cuts = request.kind == "video" && request.exact_cuts && !request.sections.is_empty();
    tauri::async_runtime::spawn_blocking(move || {
        let mut encoder = if cuts {
            fast_encoder(&ffmpeg)
        } else {
            software_encoder()
        };
        let (ended, files) = loop {
            let mut args = common_args(&ffmpeg, deno.as_deref(), &request.cookies, &cookies_file);
            args.extend(download_args(&request, &out, &encoder)?);
            let mut files: Vec<String> = Vec::new();
            let ended = run(&binary, &id, &args, &running, |line| {
                let (progress, file) = read_line(line);
                if let Some(mut progress) = progress {
                    progress.id = id.clone();
                    let _ = app.emit("ytdlp-progress", progress);
                }
                // (only what it made in its folder, each once)
                if let Some(file) = file {
                    if Path::new(&file).starts_with(&out) && !files.contains(&file) {
                        files.push(file);
                    }
                }
            })?;
            // The graphics card's encoder failed on it: again, with the processor's
            let software = software_encoder();
            if cuts
                && !ended.cancelled
                && ended.code != 0
                && files.is_empty()
                && encoder != software
            {
                HARDWARE_FAILED.store(true, Ordering::Relaxed);
                encoder = software;
                let _ = fs::remove_dir_all(&out);
                let _ = fs::create_dir_all(&out);
                continue;
            }
            break (ended, files);
        };
        let mut files = files;
        if ended.cancelled {
            let _ = fs::remove_dir_all(&out);
            return Ok(Downloaded {
                files: Vec::new(),
                cancelled: true,
                error: None,
            });
        }
        // Something after the download failed (the cover, the remux): what was downloaded is
        // kept all the same
        if files.is_empty() && !playlist {
            files.extend(media_in(&out).into_iter().take(1));
        }
        if files.is_empty() {
            let _ = fs::remove_dir_all(&out);
            return Err(explain(&ended.log));
        }
        let error = (ended.code != 0).then(|| explain(&ended.log));
        let files = files
            .into_iter()
            .filter_map(|path: String| {
                let size = fs::metadata(&path).ok()?.len();
                Some(DownloadedFile { path, size })
            })
            .collect();
        Ok(Downloaded {
            files,
            cancelled: false,
            error,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ytdlp_cancel(state: State<'_, YtdlpState>, id: String) -> Result<bool, String> {
    let child = state.running.lock().map_err(|e| e.to_string())?.remove(&id);
    Ok(match child {
        Some(child) => {
            kill_tree(child);
            true
        }
        None => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(kind: &str, format: &str) -> DownloadRequest {
        DownloadRequest {
            url: "https://www.youtube.com/watch?v=abc".into(),
            kind: kind.into(),
            format: format.into(),
            codec: None,
            height: None,
            audio_kbps: None,
            sections: vec![],
            exact_cuts: false,
            sponsorblock: false,
            playlist: false,
            playlist_items: None,
            cookies: None,
        }
    }

    fn joined(args: &[String]) -> String {
        args.join(" ")
    }

    #[test]
    fn a_video_in_a_codec() {
        let mut r = request("video", "mp4");
        r.codec = Some("h264".into());
        r.height = Some(1080);
        let args = download_args(&r, Path::new("/out"), &software_encoder()).unwrap();
        let text = joined(&args);
        assert!(
            text.contains("-f bv*[vcodec~='^(avc|h264)'][height<=1080]+(ba[acodec^=mp4a]/ba)/bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b"),
            "{text}"
        );
        assert!(text.contains("--merge-output-format mp4 --remux-video mp4"));
        assert!(text.contains("--embed-thumbnail"));
        assert!(text.contains("--no-playlist"));
        assert_eq!(
            &args[args.len() - 2..],
            ["--", "https://www.youtube.com/watch?v=abc"]
        );
        let mut r = request("video", "webm");
        r.codec = Some("vp9".into());
        let webm = joined(&download_args(&r, Path::new("/out"), &software_encoder()).unwrap());
        assert!(
            webm.contains("-f bv*[vcodec~='^vp0?9']+(ba[acodec=opus]/ba)/bv*+ba/b/bv*+ba/b"),
            "{webm}"
        );
        assert!(webm.contains("--merge-output-format webm/mkv --remux-video webm>webm/mkv"));
        assert!(!webm.contains("--embed-thumbnail"), "WebM holds no cover");
        let best = joined(
            &download_args(
                &request("video", "mkv"),
                Path::new("/out"),
                &software_encoder(),
            )
            .unwrap(),
        );
        assert!(best.contains("-f bv*+ba/bv*+ba/b/bv*+ba/b"), "{best}");
    }

    #[test]
    fn a_part_of_a_video_fast_or_exact() {
        let mut r = request("video", "mp4");
        r.sections = vec![[60.0, 90.0]];
        r.exact_cuts = false;
        let fast = joined(&download_args(&r, Path::new("/out"), &software_encoder()).unwrap());
        assert!(fast.contains("--download-sections *60.000-90.000"));
        assert!(!fast.contains("--force-keyframes-at-cuts"), "{fast}");
        assert!(!fast.contains("--downloader-args"), "{fast}");
        assert!(fast.contains("--concurrent-fragments 4"));
        r.exact_cuts = true;
        let exact = joined(&download_args(&r, Path::new("/out"), &software_encoder()).unwrap());
        assert!(exact.contains("--force-keyframes-at-cuts"));
        assert!(
            exact.contains(
                "--downloader-args ffmpeg_o:-c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k"
            ),
            "{exact}"
        );
        r.format = "webm".into();
        let webm = joined(&download_args(&r, Path::new("/out"), &software_encoder()).unwrap());
        assert!(
            webm.contains("ffmpeg_o:-c:v libvpx-vp9 -deadline realtime"),
            "{webm}"
        );
    }

    /// The fastest encoder found works (the processor's at least, with this FFmpeg)
    #[test]
    fn an_encoder_that_works() {
        let ffmpeg = Path::new("/usr/bin/ffmpeg");
        if !ffmpeg.is_file() {
            return;
        }
        let soft = software_encoder();
        assert!(encodes(
            ffmpeg,
            &soft.iter().map(String::as_str).collect::<Vec<_>>()
        ));
        assert!(!encodes(ffmpeg, &["-c:v", "no_such_encoder"]));
        let found = fast_encoder(ffmpeg);
        assert!(encodes(
            ffmpeg,
            &found.iter().map(String::as_str).collect::<Vec<_>>()
        ));
    }

    #[test]
    fn a_cookies_file_read() {
        let file = "# Netscape HTTP Cookie File\n# made by an extension\n\n.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tabc\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\tHSID\tdef\n.google.com\tTRUE\t/\tTRUE\t1893456000\tNID\tghi\r\n";
        assert_eq!(read_cookies(file), Ok((3, true)));
        assert_eq!(
            read_cookies(".twitch.tv\tTRUE\t/\tTRUE\t0\tauth\tx\n"),
            Ok((1, false))
        );
        assert!(read_cookies("[{\"name\": \"SID\"}]")
            .unwrap_err()
            .contains("JSON"));
        assert!(read_cookies("hello world").is_err());
        let args = joined(&common_args(
            Path::new("/ff"),
            None,
            &Some(COOKIES_FILE.into()),
            Path::new("/data/cookies.txt"),
        ));
        assert!(args.contains("--cookies /data/cookies.txt"), "{args}");
        assert!(!args.contains("--cookies-from-browser"));
        assert!(check_browser(&Some("file".into())).is_ok());
        assert!(check_browser(&Some("netscape".into())).is_err());
    }

    /// A ZIP unpacked whole: its folders, a program runnable, nothing out of it
    #[test]
    fn a_zip_unpacked() {
        use std::io::Write as _;
        let dir = std::env::temp_dir().join(format!("stosufy-unzip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("a.zip");
        {
            let mut zip = zip::ZipWriter::new(File::create(&zip_path).unwrap());
            let file = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored)
                .unix_permissions(0o755);
            zip.add_directory("_internal/", file).unwrap();
            zip.start_file("_internal/lib.so", file).unwrap();
            zip.write_all(b"lib").unwrap();
            zip.start_file("yt-dlp_linux", file).unwrap();
            zip.write_all(b"program").unwrap();
            zip.start_file("../outside.txt", file).unwrap();
            zip.write_all(b"no").unwrap();
            zip.finish().unwrap();
        }
        let target = dir.join("out");
        unzip_all(&zip_path, &target).unwrap();
        assert_eq!(fs::read(target.join("_internal/lib.so")).unwrap(), b"lib");
        assert!(!dir.join("outside.txt").exists(), "nothing out of it");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(target.join("yt-dlp_linux"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o111, 0o111, "runnable");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// The real yt-dlp release, in pieces at once (with STOSUFY_NET_TEST set): the same file
    /// as its checksum says, unpacked (not run here)
    #[test]
    fn the_release_downloaded_in_pieces() {
        if std::env::var("STOSUFY_NET_TEST").is_err() {
            return;
        }
        let (asset, program) = ytdlp_build().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let dir = std::env::temp_dir().join(format!("stosufy-fetch-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let zip = dir.join("yt.zip");
        let calls = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        let counted = calls.clone();
        let started = std::time::Instant::now();
        let (sums, hash) = runtime.block_on(async {
            let sums = crate::fetch::client()
                .unwrap()
                .get(format!("{RELEASE}SHA2-256SUMS"))
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            let progress = crate::fetch::every_percent(move |_, _| {
                counted.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            });
            let hash = crate::fetch::fetch(&format!("{RELEASE}{asset}"), &zip, 1, progress)
                .await
                .unwrap();
            (sums, hash)
        });
        println!("downloaded in {:?}", started.elapsed());
        assert_eq!(Some(hash), sum_for(&sums, asset));
        assert!(
            calls.load(std::sync::atomic::Ordering::Relaxed) >= 50,
            "its progress told"
        );
        unzip_all(&zip, &dir.join("out")).unwrap();
        assert!(
            dir.join("out").join(program).is_file(),
            "its program unpacked"
        );
        assert!(dir.join("out").join("_internal").is_dir(), "and its folder");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sound_and_a_part() {
        let mut r = request("audio", "mp3");
        r.audio_kbps = Some(192);
        r.sections = vec![[83.5, 125.0]];
        r.exact_cuts = true;
        r.sponsorblock = true;
        let text = joined(&download_args(&r, Path::new("/out"), &software_encoder()).unwrap());
        assert!(
            text.contains("-f ba/b -x --audio-format mp3 --audio-quality 192K --embed-thumbnail"),
            "{text}"
        );
        assert!(text.contains("--download-sections *83.500-125.000"));
        assert!(
            !text.contains("--force-keyframes-at-cuts"),
            "sound: cut as it is, not made again"
        );
        assert!(text.contains("--sponsorblock-remove sponsor,selfpromo,interaction"));
        let m4a = joined(
            &download_args(
                &request("audio", "m4a"),
                Path::new("/out"),
                &software_encoder(),
            )
            .unwrap(),
        );
        assert!(
            m4a.contains("-f ba[acodec^=mp4a]/ba/b -x --audio-format m4a --audio-quality 0"),
            "{m4a}"
        );
        let original = joined(
            &download_args(
                &request("audio", "original"),
                Path::new("/out"),
                &software_encoder(),
            )
            .unwrap(),
        );
        assert!(original.contains("-x --audio-format best"), "{original}");
    }

    #[test]
    fn a_playlist() {
        let mut r = request("audio", "mp3");
        r.playlist = true;
        r.playlist_items = Some("1-10".into());
        let text = joined(&download_args(&r, Path::new("/out"), &software_encoder()).unwrap());
        assert!(
            text.contains("-o %(playlist_index)03d %(title).140B.%(ext)s"),
            "{text}"
        );
        assert!(text.contains("--yes-playlist -I 1-10"));
        r.playlist_items = Some("1;rm".into());
        assert!(download_args(&r, Path::new("/out"), &software_encoder()).is_err());
    }

    #[test]
    fn only_what_is_offered() {
        let bad = |change: &dyn Fn(&mut DownloadRequest)| {
            let mut r = request("video", "mp4");
            change(&mut r);
            download_args(&r, Path::new("/out"), &software_encoder()).is_err()
        };
        assert!(bad(&|r| r.url = "--exec=rm -rf ~".into()));
        assert!(bad(&|r| r.url = "file:///etc/passwd".into()));
        assert!(bad(&|r| r.url = "https://a.b/x y".into()));
        assert!(bad(&|r| r.format = "exe".into()));
        assert!(bad(&|r| r.kind = "audio".into()));
        assert!(bad(&|r| r.height = Some(99_999)));
        assert!(bad(&|r| r.codec = Some("x'];--exec".into())));
        assert!(bad(&|r| {
            r.kind = "audio".into();
            r.format = "mp3".into();
            r.audio_kbps = Some(1000);
        }));
        assert!(bad(&|r| r.sections = vec![[10.0, 5.0]]));
        assert!(bad(&|r| r.sections = vec![[f64::NAN, 5.0]]));
        assert!(bad(&|r| r.cookies = Some("--exec".into())));
        assert!(!bad(&|r| r.cookies = Some("firefox".into())));
        assert!(!bad(&|r| r.height = Some(1920)), "a phone's upright video");
    }

    #[test]
    fn common_and_sums() {
        let args = joined(&common_args(
            Path::new("/ff/ffmpeg"),
            Some(Path::new("/d/deno")),
            &Some("chrome".into()),
            Path::new("/c"),
        ));
        assert!(args.starts_with("--ignore-config --no-plugin-dirs --no-update --encoding utf-8"));
        assert!(args.contains("--ffmpeg-location /ff/ffmpeg --js-runtimes deno:/d/deno"));
        assert!(args.ends_with("--cookies-from-browser chrome"));
        let sums = "aaaa  yt-dlp\nf5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d  yt-dlp.exe\n";
        assert_eq!(
            sum_for(sums, "yt-dlp.exe").unwrap(),
            "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d"
        );
        assert!(sum_for(sums, "yt-dlp").is_none(), "not a SHA-256");
        assert!(sum_for(sums, "yt-dlp_macos").is_none());
    }

    #[test]
    fn its_output_read() {
        let p = read_line("[dl]  45.2%|1.21MiB/s|00:12|3|20|avc1.640028")
            .0
            .unwrap();
        assert_eq!(p.percent, Some(45.2));
        assert_eq!(p.speed.as_deref(), Some("1.21MiB/s"));
        assert_eq!(p.eta.as_deref(), Some("00:12"));
        assert_eq!((p.index, p.count), (Some(3), Some(20)));
        assert_eq!(p.stream.as_deref(), Some("video"));
        let p = read_line("[dl] 100.0%|455.52KiB/s|NA|NA|NA|none")
            .0
            .unwrap();
        assert_eq!(
            (p.eta, p.index, p.stream.as_deref()),
            (None, None, Some("audio"))
        );
        let p = read_line("[dl] 10.0%|NA|Unknown|||").0.unwrap();
        assert_eq!((p.speed, p.eta, p.stream), (None, None, None));
        assert_eq!(read_line("[pp] Merger").0.unwrap().phase, "Merger");
        assert_eq!(read_line("[done] /a/b c.mp4").1.unwrap(), "/a/b c.mp4");
        assert!(read_line("[youtube] abc: Downloading").0.is_none());
        let said = |error: &str| explain(&format!("WARNING: x\nERROR: {error}"));
        assert_eq!(
            said("[youtube] abc: Private video. Sign in if you've been granted access"),
            "This video is private"
        );
        assert_eq!(
            said("Unsupported URL: https://x"),
            "This site isn't one it can download from"
        );
        assert!(
            said("Unable to download webpage: HTTP Error 429: Too Many Requests")
                .contains("too many")
        );
        assert!(said("Unable to download webpage: HTTP Error 404: Not Found").contains("404"));
        assert!(said("[youtube] x: Sign in to confirm your age").contains("signed in"));
        assert!(
            said("Could not copy Chrome cookie database. See https://...")
                .contains("close the browser")
        );
        assert!(said(
            "Unable to download webpage: <urlopen error [Errno -2] Name or service not known>"
        )
        .contains("online"));
    }

    #[test]
    fn a_group_of_its_own() {
        let dir = std::env::temp_dir().join(format!("stosufy-tree-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        // (a program that starts another, as yt-dlp starts FFmpeg: both stopped)
        let script = dir.join("parent.sh");
        let pidfile = dir.join("child.pid");
        fs::write(
            &script,
            format!(
                "#!/bin/sh\nsleep 60 &\necho $! > {}\nwait\n",
                pidfile.display()
            ),
        )
        .unwrap();
        make_runnable(&script).unwrap();
        #[cfg(target_os = "linux")]
        {
            let child = command(&script).stdout(Stdio::null()).spawn().unwrap();
            for _ in 0..50 {
                if pidfile.exists() && !fs::read_to_string(&pidfile).unwrap().trim().is_empty() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            let grandchild = fs::read_to_string(&pidfile).unwrap().trim().to_string();
            kill_tree(child);
            std::thread::sleep(std::time::Duration::from_millis(100));
            // (gone, or a zombie no one has collected yet: not running)
            let state = fs::read_to_string(format!("/proc/{grandchild}/stat")).unwrap_or_default();
            let running = state
                .rsplit(')')
                .next()
                .map(|rest| !rest.trim_start().starts_with('Z'))
                .unwrap_or(false);
            assert!(!running, "what it started is stopped too: {state}");
        }
    }

    #[test]
    fn deno_unpacked() {
        let dir = std::env::temp_dir().join(format!("stosufy-deno-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("d.zip");
        {
            let mut zip = zip::ZipWriter::new(File::create(&zip_path).unwrap());
            zip.start_file::<_, ()>(format!("deno{EXE}"), Default::default())
                .unwrap();
            zip.write_all(b"#!/bin/sh\n").unwrap();
            zip.finish().unwrap();
        }
        let target = dir.join("deno");
        unzip_one(&zip_path, &format!("deno{EXE}"), &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"#!/bin/sh\n");
        assert!(unzip_one(&zip_path, "other", &dir.join("x")).is_err());
    }

    /// A real download, with a yt-dlp and FFmpeg given (YTDLP_TEST_BIN, YTDLP_TEST_URL: an HLS
    /// stream at least 6 s long; skipped without them)
    #[test]
    fn downloads_a_part_as_mp3() {
        let (Ok(bin), Ok(url)) = (
            std::env::var("YTDLP_TEST_BIN"),
            std::env::var("YTDLP_TEST_URL"),
        ) else {
            return;
        };
        let out = std::env::temp_dir().join(format!("stosufy-ytdlp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&out);
        fs::create_dir_all(&out).unwrap();
        let mut r = request("audio", "mp3");
        r.url = url;
        r.sections = vec![[2.0, 5.0]];
        r.exact_cuts = true;
        let mut args = common_args(Path::new("/usr/bin/ffmpeg"), None, &None, Path::new("/c"));
        args.extend(download_args(&r, &out, &software_encoder()).unwrap());
        let running = Mutex::new(HashMap::new());
        let (mut percents, mut steps, mut files) = (vec![], vec![], vec![]);
        let ended = run(Path::new(&bin), "t", &args, &running, |line| {
            let (progress, file) = read_line(line);
            if let Some(progress) = progress {
                if let Some(p) = progress.percent {
                    percents.push(p);
                }
                steps.push(progress.phase);
            }
            files.extend(file);
        })
        .unwrap();
        assert_eq!(ended.code, 0, "{}", ended.log);
        assert_eq!(files.len(), 1, "{files:?}");
        assert!(files[0].ends_with(".mp3") && Path::new(&files[0]).is_file());
        assert!(
            percents.last().copied().unwrap_or(0.0) >= 99.9,
            "{percents:?}"
        );
        assert!(steps.iter().any(|s| s == "ExtractAudio"), "{steps:?}");
    }
}
