//! The add-ons' tools downloaded (yt-dlp, FFmpeg, Deno): in four pieces at once where the
//! server lets it (GitHub's downloads do: one connection alone is often slowed down), else in
//! one; each piece tried again where it broke off. Its SHA-256 over the whole of it.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sha2::{Digest, Sha256};

/// At once, for a file big enough (smaller: in one)
const PIECES: u64 = 4;
const SPLIT_FROM: u64 = 4 * 1024 * 1024;

/// How far it is: received and total bytes
pub type Progress = Arc<dyn Fn(u64, u64) + Send + Sync>;

/// `report` called with how far it is, each hundredth of the way (not for every piece of it)
pub fn every_percent(report: impl Fn(u64, u64) + Send + Sync + 'static) -> Progress {
    let last = AtomicU64::new(0);
    Arc::new(move |received, total| {
        let step = (total / 100).max(1);
        let was = last.load(Ordering::Relaxed);
        if received >= total || received.saturating_sub(was) >= step {
            last.store(received, Ordering::Relaxed);
            report(received, total);
        }
    })
}

/// HTTP with time limits: a connection that stalls ends with an error, not never
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

/// Its total size and where it really is (after redirects), if the server sends it in pieces
async fn in_pieces(client: &reqwest::Client, url: &str) -> Option<(u64, String)> {
    let response = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
        .ok()?;
    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return None;
    }
    let total = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)?
        .to_str()
        .ok()?
        .rsplit('/')
        .next()?
        .parse::<u64>()
        .ok()?;
    Some((total, response.url().to_string()))
}

/// A piece of a download: its bytes `from..=to`, into the file `part`
struct Span {
    from: u64,
    to: u64,
    part: PathBuf,
}

/// A piece of `url` downloaded (again from where it broke off, up to three times)
async fn piece(
    client: reqwest::Client,
    url: String,
    span: Span,
    received: Arc<AtomicU64>,
    progress: Progress,
    total: u64,
) -> Result<(), String> {
    let Span { from, to, part } = span;
    let mut file = File::create(&part).map_err(|e| e.to_string())?;
    let mut done = 0u64;
    let mut tries = 0;
    while from + done <= to {
        let result: Result<(), String> = async {
            let mut response = client
                .get(&url)
                .header(
                    reqwest::header::RANGE,
                    format!("bytes={}-{to}", from + done),
                )
                .send()
                .await
                .map_err(|e| format!("Couldn't download it: {e}"))?;
            if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                return Err(format!("Couldn't download it ({})", response.status()));
            }
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|e| format!("The download broke off: {e}"))?
            {
                file.write_all(&chunk).map_err(|e| e.to_string())?;
                done += chunk.len() as u64;
                let now =
                    received.fetch_add(chunk.len() as u64, Ordering::Relaxed) + chunk.len() as u64;
                progress(now, total);
            }
            Ok(())
        }
        .await;
        match result {
            Ok(()) => break,
            Err(error) if tries >= 3 => return Err(error),
            Err(_) => {
                tries += 1;
                tokio::time::sleep(Duration::from_millis(500 * tries)).await;
            }
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    if done != to - from + 1 {
        return Err("The download broke off".into());
    }
    Ok(())
}

/// The pieces put together into `to`, in order; their SHA-256
fn join(parts: &[PathBuf], to: &Path) -> Result<String, String> {
    let mut out = File::create(to).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    for part in parts {
        let mut file = File::open(part).map_err(|e| e.to_string())?;
        loop {
            let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
            out.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// In one connection (a server that doesn't send pieces)
async fn whole(
    client: &reqwest::Client,
    url: &str,
    to: &Path,
    size: u64,
    progress: &Progress,
) -> Result<String, String> {
    let mut response = client
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
    let mut received = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("The download broke off: {e}"))?
    {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        progress(received, total);
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// `url` downloaded to `to` (about `size` bytes, for the progress until the server says);
/// its SHA-256
pub async fn fetch(url: &str, to: &Path, size: u64, progress: Progress) -> Result<String, String> {
    let client = client()?;
    let split = match in_pieces(&client, url).await {
        Some((total, real)) if total >= SPLIT_FROM => Some((total, real)),
        _ => None,
    };
    let Some((total, real)) = split else {
        return whole(&client, url, to, size, &progress).await;
    };
    let each = total.div_ceil(PIECES);
    let received = Arc::new(AtomicU64::new(0));
    let parts: Vec<PathBuf> = (0..PIECES)
        .map(|i| to.with_extension(format!("piece{i}")))
        .collect();
    let mut tasks = Vec::new();
    for (i, part) in parts.iter().enumerate() {
        let from = i as u64 * each;
        if from >= total {
            break;
        }
        let end = ((i as u64 + 1) * each).min(total) - 1;
        let span = Span {
            from,
            to: end,
            part: part.clone(),
        };
        tasks.push(tauri::async_runtime::spawn(piece(
            client.clone(),
            real.clone(),
            span,
            received.clone(),
            progress.clone(),
            total,
        )));
    }
    let used = tasks.len();
    let mut failed = None;
    for task in tasks {
        match task.await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => failed = failed.or(Some(error)),
            Err(error) => failed = failed.or(Some(error.to_string())),
        }
    }
    let result = match failed {
        Some(error) => Err(error),
        None => join(&parts[..used], to),
    };
    for part in &parts {
        let _ = fs::remove_file(part);
    }
    result
}
