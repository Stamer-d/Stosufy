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
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

const RELEASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
pub const DENO_VERSION: &str = "2.9.8";

/// yt-dlp's file for this computer (its release's name for it)
fn ytdlp_asset() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("yt-dlp.exe"),
        ("macos", _) => Some("yt-dlp_macos"),
        ("linux", "x86_64") => Some("yt-dlp_linux"),
        ("linux", "aarch64") => Some("yt-dlp_linux_aarch64"),
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

fn ytdlp_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(tools_dir(app)?.join("yt-dlp").join(format!("yt-dlp{EXE}")))
}

fn deno_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(tools_dir(app)?
        .join("deno")
        .join(DENO_VERSION)
        .join(format!("deno{EXE}")))
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
        supported: ytdlp_asset().is_some(),
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

fn sha256_of(path: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// HTTP with time limits: a connection that stalls ends with an error, not never
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

/// Downloads `url` to `to` (progress as `ytdlp-install` events); its SHA-256
async fn fetch(
    app: &AppHandle,
    what: &'static str,
    url: &str,
    to: &Path,
    size: u64,
) -> Result<String, String> {
    let mut response = client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Couldn't download it: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't download it ({})", response.status()));
    }
    let total = response.content_length().unwrap_or(size);
    let mut file = File::create(to).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let (mut received, mut reported) = (0u64, 0u64);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("The download broke off: {e}"))?
    {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        if received - reported > total / 100 {
            reported = received;
            let _ = app.emit(
                "ytdlp-install",
                InstallProgress {
                    what,
                    received,
                    total,
                },
            );
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
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
    let asset = ytdlp_asset().ok_or("There's no yt-dlp for this computer")?;
    let _installing = Installing::start(&state.installing_ytdlp)?;
    let busy = !state.running.lock().map_err(|e| e.to_string())?.is_empty();
    if busy && ytdlp_path(&app)?.is_file() {
        return Ok("busy".into());
    }
    install_ytdlp(&app, asset).await
}

async fn install_ytdlp(app: &AppHandle, asset: &str) -> Result<String, String> {
    let target = ytdlp_path(app)?;
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
    let had = target.is_file();
    if had && sha256_of(&target)? == wanted {
        return Ok("current".into());
    }
    let dir = target.parent().ok_or("no folder")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let part = target.with_extension("part");
    let hash = fetch(
        app,
        "yt-dlp",
        &format!("{RELEASE}{asset}"),
        &part,
        40_000_000,
    )
    .await;
    let hash = hash.inspect_err(|_| {
        let _ = fs::remove_file(&part);
    })?;
    if hash != wanted {
        let _ = fs::remove_file(&part);
        return Err("The download isn't the expected file (its checksum differs)".into());
    }
    make_runnable(&part)?;
    fs::rename(&part, &target)
        .inspect_err(|_| {
            let _ = fs::remove_file(&part);
        })
        .map_err(|e| e.to_string())?;
    Ok(if had { "updated" } else { "installed" }.into())
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

/// A link to a page (nothing that would be read as an option, a file or another protocol)
pub fn check_url(url: &str) -> Result<(), String> {
    let ok = (url.starts_with("https://") || url.starts_with("http://"))
        && url.len() < 4096
        && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    ok.then_some(()).ok_or_else(|| "That's not a link".into())
}

fn check_browser(cookies: &Option<String>) -> Result<(), String> {
    match cookies {
        Some(browser) if !BROWSERS.contains(&browser.as_str()) => {
            Err("Not a browser it knows".into())
        }
        _ => Ok(()),
    }
}

/// What every run gets: no configuration, plugins or updates of its own, UTF-8, our FFmpeg,
/// Deno for YouTube, the browser's sign-in
pub fn common_args(ffmpeg: &Path, deno: Option<&Path>, cookies: &Option<String>) -> Vec<String> {
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
    if let Some(browser) = cookies {
        args.push("--cookies-from-browser".into());
        args.push(browser.clone());
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

/// yt-dlp's arguments for a download into `out` (checked: only what's offered)
pub fn download_args(request: &DownloadRequest, out: &Path) -> Result<Vec<String>, String> {
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
    if !request.sections.is_empty() && request.exact_cuts {
        push(&["--force-keyframes-at-cuts"]);
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
    let mut args = common_args(&ffmpeg, deno.as_deref(), &cookies);
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
    found.sort_by(|a, b| b.0.cmp(&a.0));
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
    let mut args = common_args(&ffmpeg, deno.as_deref(), &request.cookies);
    args.extend(download_args(&request, &out)?);
    let running = state.running.clone();
    let playlist = request.playlist;
    tauri::async_runtime::spawn_blocking(move || {
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
        let args = download_args(&r, Path::new("/out")).unwrap();
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
        let webm = joined(&download_args(&r, Path::new("/out")).unwrap());
        assert!(
            webm.contains("-f bv*[vcodec~='^vp0?9']+(ba[acodec=opus]/ba)/bv*+ba/b/bv*+ba/b"),
            "{webm}"
        );
        assert!(webm.contains("--merge-output-format webm/mkv --remux-video webm>webm/mkv"));
        assert!(!webm.contains("--embed-thumbnail"), "WebM holds no cover");
        let best = joined(&download_args(&request("video", "mkv"), Path::new("/out")).unwrap());
        assert!(best.contains("-f bv*+ba/bv*+ba/b/bv*+ba/b"), "{best}");
    }

    #[test]
    fn sound_and_a_part() {
        let mut r = request("audio", "mp3");
        r.audio_kbps = Some(192);
        r.sections = vec![[83.5, 125.0]];
        r.exact_cuts = true;
        r.sponsorblock = true;
        let text = joined(&download_args(&r, Path::new("/out")).unwrap());
        assert!(
            text.contains("-f ba/b -x --audio-format mp3 --audio-quality 192K --embed-thumbnail"),
            "{text}"
        );
        assert!(text.contains("--download-sections *83.500-125.000 --force-keyframes-at-cuts"));
        assert!(text.contains("--sponsorblock-remove sponsor,selfpromo,interaction"));
        let m4a = joined(&download_args(&request("audio", "m4a"), Path::new("/out")).unwrap());
        assert!(
            m4a.contains("-f ba[acodec^=mp4a]/ba/b -x --audio-format m4a --audio-quality 0"),
            "{m4a}"
        );
        let original =
            joined(&download_args(&request("audio", "original"), Path::new("/out")).unwrap());
        assert!(original.contains("-x --audio-format best"), "{original}");
    }

    #[test]
    fn a_playlist() {
        let mut r = request("audio", "mp3");
        r.playlist = true;
        r.playlist_items = Some("1-10".into());
        let text = joined(&download_args(&r, Path::new("/out")).unwrap());
        assert!(
            text.contains("-o %(playlist_index)03d %(title).140B.%(ext)s"),
            "{text}"
        );
        assert!(text.contains("--yes-playlist -I 1-10"));
        r.playlist_items = Some("1;rm".into());
        assert!(download_args(&r, Path::new("/out")).is_err());
    }

    #[test]
    fn only_what_is_offered() {
        let bad = |change: &dyn Fn(&mut DownloadRequest)| {
            let mut r = request("video", "mp4");
            change(&mut r);
            download_args(&r, Path::new("/out")).is_err()
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
        let mut args = common_args(Path::new("/usr/bin/ffmpeg"), None, &None);
        args.extend(download_args(&r, &out).unwrap());
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
