//! The Claude connection (MCP, the Model Context Protocol): Claude asks Stosufy about the
//! user's listening, library, playlists and osu!, makes playlists and plays music.
//!
//! Claude starts `Stosufy --mcp` itself (the bridge, `run_bridge`) and talks to it on stdin
//! and stdout. The bridge answers what it knows on its own (the tools and prompts) and hands
//! tool calls to the running app over a small HTTP server on this computer (127.0.0.1 only,
//! with a token), opening the app first if it isn't open. The app passes each call to its
//! window, where the tools run with the app's own data (src/lib/mcp), and sends back what
//! they found. The server only takes programs on this computer; what the tools answer goes
//! to Claude, into the user's chat.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// What the tools are and take (their code is in src/lib/mcp/tools.ts)
const TOOLS: &str = include_str!("../../src/lib/mcp/tools.json");
const PROMPTS: &str = include_str!("../../src/lib/mcp/prompts.json");
/// The app's identifier (tauri.conf.json): its data folder is named after it
const IDENTIFIER: &str = "com.Stosufy.app";
const CONNECTION_FILE: &str = "claude-connection.json";
const SERVER_NAME: &str = "stosufy";
/// Newest first; a client asking for an older one gets that one
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
/// The port the server tries first (then the one it had, then any)
const DEFAULT_PORT: u16 = 47821;
/// How long a tool may take in the app (the tools themselves stop well before)
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
/// How long a call waits for the window to be ready (the app just started)
const READY_WAIT: Duration = Duration::from_secs(40);
/// How long the bridge waits for the app it opened
const LAUNCH_WAIT: Duration = Duration::from_secs(45);
const MAX_BODY: usize = 8 * 1024 * 1024;

const INSTRUCTIONS: &str = "Stosufy is the user's music player for osu! songs: every song from osu!'s beatmaps, their downloaded library, playlists, likes and listening history.
- A song is identified by its song id: the osu! beatmap set id, with \":track\" for the few sets that contain several songs (\"1234567\", \"1234567:1\"). Use the ids the tools return.
- For anything about the user's taste start with get_listening_stats; get_osu_profile_songs helps while their Stosufy history is short.
- find_similar_songs ranks songs the way Stosufy's radio does (artists, anime or game, mapper, genre, language, tempo, tags, plus the user's plays, likes and skips). search_osu finds any song on osu! (it has osu!'s search syntax), search_library looks through the downloaded songs.
- Downloaded songs play instantly and offline; the others stream (if the user turned streaming on) or play a preview until they're downloaded.
- osu! has several beatmap sets of many songs (TV size, cut, sped up): put one version of a song in a playlist, the full one unless asked otherwise.
- To make a playlist: gather candidates, choose and order them yourself (tempo and energy that flow, varied artists), then create_playlist once; refine it with add_to_playlist and remove_from_playlist.
- Playlists show up in the app right away. Make a playlist public, delete one, download songs, play music or change playback only when the user asks for it.
- Write playlist titles and descriptions in the language the user writes in, unless they want otherwise.";

const TURNED_OFF: &str = "Claude's access to Stosufy is turned off. The user can turn it on in Stosufy: Settings → Claude.";
const NO_CHANGES: &str = "The user lets Claude only look at Stosufy, not change anything (Stosufy: Settings → Claude → \"Let Claude make changes\"). Tell them what you would do, or ask them to allow changes.";

// --- Tools and prompts ----------------------------------------------------------------------

fn tools() -> &'static Vec<Value> {
    static TOOL_LIST: OnceLock<Vec<Value>> = OnceLock::new();
    TOOL_LIST.get_or_init(|| serde_json::from_str(TOOLS).expect("tools.json is a list of tools"))
}

fn prompts() -> &'static Vec<Value> {
    static PROMPT_LIST: OnceLock<Vec<Value>> = OnceLock::new();
    PROMPT_LIST
        .get_or_init(|| serde_json::from_str(PROMPTS).expect("prompts.json is a list of prompts"))
}

fn tool(name: &str) -> Option<&'static Value> {
    tools().iter().find(|tool| tool["name"] == name)
}

/// Whether a tool only looks (else it changes something: a playlist, what plays)
fn read_only(name: &str) -> bool {
    tool(name).is_some_and(|tool| tool["annotations"]["readOnlyHint"] == true)
}

/// A tool's answer that something went wrong (Claude reads it and can tell the user)
pub fn tool_error(text: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": true })
}

fn prompt_list() -> Vec<Value> {
    prompts()
        .iter()
        .map(|prompt| {
            let arguments: Vec<Value> = prompt["arguments"]
                .as_array()
                .map(|list| {
                    list.iter()
                        .map(|argument| {
                            json!({
                                "name": argument["name"],
                                "description": argument["description"],
                                "required": argument["required"].as_bool().unwrap_or(false)
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            json!({
                "name": prompt["name"],
                "title": prompt["title"],
                "description": prompt["description"],
                "arguments": arguments
            })
        })
        .collect()
}

/// A prompt with the user's arguments filled in (the defaults where they gave none)
fn get_prompt(params: &Value) -> Result<Value, (i64, String)> {
    let name = params["name"].as_str().unwrap_or_default();
    let prompt = prompts()
        .iter()
        .find(|prompt| prompt["name"] == name)
        .ok_or((-32602, format!("Unknown prompt: {name}")))?;
    let mut text = prompt["template"].as_str().unwrap_or_default().to_string();
    for argument in prompt["arguments"].as_array().into_iter().flatten() {
        let key = argument["name"].as_str().unwrap_or_default();
        let given = params["arguments"][key].as_str().map(str::trim).unwrap_or_default();
        if given.is_empty() && argument["required"] == true {
            return Err((-32602, format!("The prompt needs \"{key}\"")));
        }
        let value = if given.is_empty() {
            argument["default"].as_str().unwrap_or_default()
        } else {
            given
        };
        text = text.replace(&format!("{{{{{key}}}}}"), value);
    }
    // (an empty optional argument leaves a gap)
    let text = text.replace(" \n", "\n").replace("  ", " ");
    Ok(json!({
        "description": prompt["description"],
        "messages": [{ "role": "user", "content": { "type": "text", "text": text.trim() } }]
    }))
}

// --- The protocol (JSON-RPC 2.0) ------------------------------------------------------------

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn initialize(params: &Value) -> Value {
    let asked = params["protocolVersion"].as_str().unwrap_or_default();
    let version = PROTOCOL_VERSIONS
        .iter()
        .find(|known| **known == asked)
        .unwrap_or(&PROTOCOL_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": {
            "tools": { "listChanged": false },
            "prompts": { "listChanged": false }
        },
        "serverInfo": {
            "name": SERVER_NAME,
            "title": "Stosufy",
            "version": env!("CARGO_PKG_VERSION")
        },
        "instructions": INSTRUCTIONS
    })
}

/// Answers a message: None for notifications (and for responses, the server asks nothing).
/// Tool calls go to `call`, which returns the tool's result.
pub fn answer(message: &Value, call: &dyn Fn(&str, Value) -> Value) -> Option<Value> {
    if let Some(batch) = message.as_array() {
        let answers: Vec<Value> = batch.iter().filter_map(|one| answer(one, call)).collect();
        return (!answers.is_empty()).then(|| Value::Array(answers));
    }
    let id = message.get("id").cloned();
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        let response = message.get("result").is_some() || message.get("error").is_some();
        return match id {
            Some(id) if !response => Some(rpc_error(id, -32600, "Invalid request")),
            _ => None,
        };
    };
    // A notification (initialized, cancelled…): nothing to answer
    let id = id?;
    let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = match method {
        "initialize" => Ok(initialize(&params)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "prompts/list" => Ok(json!({ "prompts": prompt_list() })),
        "prompts/get" => get_prompt(&params),
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or_default();
            if tool(name).is_none() {
                Err((-32602, format!("Unknown tool: {name}")))
            } else {
                let arguments = match params.get("arguments") {
                    Some(Value::Object(arguments)) => Value::Object(arguments.clone()),
                    _ => json!({}),
                };
                Ok(call(name, arguments))
            }
        }
        _ => Err((-32601, format!("Method not found: {method}"))),
    };
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, text)) => rpc_error(id, code, &text),
    })
}

// --- What the app and the bridge share: the connection file ----------------------------------

/// Kept in the app's data folder: whether Claude may connect, the token and the port
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Connection {
    pub enabled: bool,
    /// Claude may also change things (playlists, playback), not only look
    pub allow_changes: bool,
    pub token: String,
    pub port: Option<u16>,
}

impl Default for Connection {
    fn default() -> Self {
        Connection { enabled: false, allow_changes: true, token: String::new(), port: None }
    }
}

fn connection_file() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(IDENTIFIER).join(CONNECTION_FILE))
}

fn read_connection() -> Connection {
    connection_file()
        .and_then(|file| fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_connection(connection: &Connection) -> io::Result<()> {
    let file = connection_file().ok_or_else(|| io::Error::other("no data folder"))?;
    write_atomically(&file, serde_json::to_string_pretty(connection)?.as_bytes())
}

/// Written next to it and then put in its place, so a reader never sees half of it
fn write_atomically(file: &Path, contents: &[u8]) -> io::Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let temporary = file.with_extension("tmp");
    fs::write(&temporary, contents)?;
    fs::rename(&temporary, file)
}

fn new_token() -> String {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).expect("the system has random numbers");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The program Claude starts: the app itself (on Linux the AppImage, not its mounted copy)
pub fn app_executable() -> io::Result<PathBuf> {
    #[cfg(target_os = "linux")]
    if let Some(image) = std::env::var_os("APPIMAGE") {
        return Ok(PathBuf::from(image));
    }
    std::env::current_exe()
}

// --- The server in the app ------------------------------------------------------------------

type Caller = Arc<dyn Fn(&str, Value) -> Value + Send + Sync>;

/// Reads one HTTP request (just what an MCP client sends) and answers it
fn handle_http(stream: TcpStream, token: &str, call: &dyn Fn(&str, Value) -> Value) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    let mut writer = stream.try_clone()?;
    let mut reader = BufReader::new(stream);
    let mut head = (&mut reader).take(32 * 1024);
    let mut line = String::new();
    head.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().split('?').next().unwrap_or_default().to_string();
    let mut headers = HashMap::new();
    loop {
        line.clear();
        if head.read_line(&mut line)? == 0 || line.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let length: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if length > MAX_BODY {
        return respond(&mut writer, 413, "Payload Too Large", None, b"");
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;

    // Only programs on this computer, never a website (a page can't send these headers to
    // another site without the browser saying where it's from)
    if headers.contains_key("origin") {
        return respond(&mut writer, 403, "Forbidden", None, b"");
    }
    let expected = format!("Bearer {token}");
    if headers.get("authorization").map(String::as_str) != Some(expected.as_str()) {
        return respond(&mut writer, 401, "Unauthorized", None, b"");
    }
    match (method.as_str(), path.as_str()) {
        ("POST", "/mcp") => {
            let reply = match serde_json::from_slice::<Value>(&body) {
                Ok(message) => answer(&message, call),
                Err(_) => Some(rpc_error(Value::Null, -32700, "Parse error")),
            };
            match reply {
                Some(reply) => respond(
                    &mut writer,
                    200,
                    "OK",
                    Some("application/json"),
                    reply.to_string().as_bytes(),
                ),
                None => respond(&mut writer, 202, "Accepted", None, b""),
            }
        }
        (_, "/mcp") => respond(&mut writer, 405, "Method Not Allowed", None, b""),
        _ => respond(&mut writer, 404, "Not Found", None, b""),
    }
}

fn respond(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: Option<&str>,
    body: &[u8],
) -> io::Result<()> {
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n",
        body.len()
    );
    if let Some(content_type) = content_type {
        head.push_str(&format!("Content-Type: {content_type}\r\n"));
    }
    if status == 405 {
        head.push_str("Allow: POST\r\n");
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

/// The port the server gets: the default one, the one it had before, or any free one
fn bind(previous: Option<u16>) -> io::Result<TcpListener> {
    for port in [Some(DEFAULT_PORT), previous].into_iter().flatten() {
        if let Ok(listener) = TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
            return Ok(listener);
        }
    }
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
}

fn serve(listener: TcpListener, token: String, call: Caller) {
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let token = token.clone();
            let call = call.clone();
            thread::spawn(move || {
                if let Err(error) = handle_http(stream, &token, &*call) {
                    eprintln!("Claude connection: a request failed: {error}");
                }
            });
        }
    });
}

/// The app's side: the connection, the server and the calls waiting for the window
pub struct Shared {
    app: AppHandle,
    connection: Mutex<Connection>,
    port: Mutex<Option<u16>>,
    /// The window listens for calls
    ready: AtomicBool,
    next_id: AtomicU64,
    waiting: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
}

impl Shared {
    fn connection(&self) -> Connection {
        self.connection.lock().unwrap().clone()
    }

    fn save(&self, connection: Connection) -> Result<(), String> {
        write_connection(&connection).map_err(|error| format!("Could not save it: {error}"))?;
        *self.connection.lock().unwrap() = connection;
        Ok(())
    }

    /// Starts the server, once (turning the connection off keeps it, it then says no)
    fn start(self: &Arc<Self>) -> Result<(), String> {
        let mut port = self.port.lock().unwrap();
        if port.is_some() {
            return Ok(());
        }
        let mut connection = self.connection();
        let listener = bind(connection.port).map_err(|error| format!("No port for Claude: {error}"))?;
        let bound = listener.local_addr().map_err(|error| error.to_string())?.port();
        connection.port = Some(bound);
        self.save(connection.clone())?;
        *port = Some(bound);
        let shared = self.clone();
        let call = move |name: &str, arguments: Value| shared.call(name, arguments);
        serve(listener, connection.token, Arc::new(call));
        Ok(())
    }

    /// A tool call: handed to the window, which runs the tool and replies (mcp_reply)
    fn call(&self, name: &str, arguments: Value) -> Value {
        let connection = self.connection();
        if !connection.enabled {
            return tool_error(TURNED_OFF);
        }
        if !read_only(name) && !connection.allow_changes {
            return tool_error(NO_CHANGES);
        }
        let started = Instant::now();
        while !self.ready.load(Ordering::SeqCst) {
            if started.elapsed() > READY_WAIT {
                return tool_error("Stosufy is still starting. Try again in a moment.");
            }
            thread::sleep(Duration::from_millis(200));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = mpsc::channel();
        self.waiting.lock().unwrap().insert(id, sender);
        let request = json!({ "id": id, "name": name, "arguments": arguments });
        if let Err(error) = self.app.emit_to("main", "mcp-call", request) {
            self.waiting.lock().unwrap().remove(&id);
            return tool_error(&format!("Stosufy couldn't run the tool: {error}"));
        }
        match receiver.recv_timeout(CALL_TIMEOUT) {
            Ok(result) => result,
            Err(_) => {
                self.waiting.lock().unwrap().remove(&id);
                tool_error("Stosufy didn't answer in time. Try again, maybe with a smaller request.")
            }
        }
    }

    fn status(&self) -> Status {
        let connection = self.connection();
        let command = app_executable().map(|path| path.to_string_lossy().into_owned()).unwrap_or_default();
        let port = *self.port.lock().unwrap();
        Status {
            enabled: connection.enabled,
            allow_changes: connection.allow_changes,
            running: port.is_some(),
            port,
            claude_code: claude_code_connected(),
            command,
            args: vec!["--mcp".into()],
        }
    }
}

/// Reads the connection and starts the server if Claude may connect (on start)
pub fn setup(app: &AppHandle) {
    let mut connection = read_connection();
    if connection.token.is_empty() {
        connection.token = new_token();
        let _ = write_connection(&connection);
    }
    let enabled = connection.enabled;
    let shared = Arc::new(Shared {
        app: app.clone(),
        connection: Mutex::new(connection),
        port: Mutex::new(None),
        ready: AtomicBool::new(false),
        next_id: AtomicU64::new(1),
        waiting: Mutex::new(HashMap::new()),
    });
    if enabled {
        if let Err(error) = shared.start() {
            eprintln!("Claude connection: {error}");
        }
    }
    app.manage(shared);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    allow_changes: bool,
    running: bool,
    port: Option<u16>,
    /// What Claude starts: this program with these arguments
    command: String,
    args: Vec<String>,
    /// Claude Code has Stosufy in its user settings
    claude_code: bool,
}

#[tauri::command]
pub fn mcp_status(shared: State<'_, Arc<Shared>>) -> Status {
    shared.status()
}

#[tauri::command]
pub fn mcp_set_enabled(shared: State<'_, Arc<Shared>>, enabled: bool) -> Result<Status, String> {
    let mut connection = shared.connection();
    connection.enabled = enabled;
    shared.save(connection)?;
    if enabled {
        shared.start()?;
    }
    Ok(shared.status())
}

#[tauri::command]
pub fn mcp_set_allow_changes(shared: State<'_, Arc<Shared>>, allow: bool) -> Result<Status, String> {
    let mut connection = shared.connection();
    connection.allow_changes = allow;
    shared.save(connection)?;
    Ok(shared.status())
}

/// The window listens for tool calls now
#[tauri::command]
pub fn mcp_ready(shared: State<'_, Arc<Shared>>) {
    shared.ready.store(true, Ordering::SeqCst);
}

/// What a tool the window ran found
#[tauri::command]
pub fn mcp_reply(shared: State<'_, Arc<Shared>>, id: u64, result: Value) {
    if let Some(sender) = shared.waiting.lock().unwrap().remove(&id) {
        let _ = sender.send(result);
    }
}

// --- Claude Desktop and Claude Code -----------------------------------------------------------

const CLAUDE_CONFIG: &str = "claude_desktop_config.json";

/// Where Claude Desktop keeps its settings (the Windows Store version in its own folder too)
fn claude_desktop_configs() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(config) = dirs::config_dir() {
        paths.push(config.join("Claude").join(CLAUDE_CONFIG));
    }
    #[cfg(windows)]
    if let Some(local) = dirs::data_local_dir() {
        if let Ok(entries) = fs::read_dir(local.join("Packages")) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().starts_with("Claude_") {
                    let roaming = entry.path().join("LocalCache").join("Roaming");
                    paths.push(roaming.join("Claude").join(CLAUDE_CONFIG));
                }
            }
        }
    }
    paths
}

/// The settings files of the Claude Desktop installs on this computer, each once
fn installed_configs() -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    claude_desktop_configs()
        .into_iter()
        .filter(|path| {
            let Some(dir) = path.parent().filter(|dir| dir.is_dir()) else {
                return false;
            };
            seen.insert(fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf()))
        })
        .collect()
}

fn read_json_object(path: &Path) -> Result<Map<String, Value>, String> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => return Err(format!("Could not read {}: {error}", path.display())),
    };
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(object)) => Ok(object),
        _ => Err(format!(
            "Claude's settings file isn't valid JSON, so it wasn't changed: {}",
            path.display()
        )),
    }
}

fn server_entry() -> Result<Value, String> {
    let command = app_executable().map_err(|error| error.to_string())?;
    Ok(json!({ "command": command.to_string_lossy(), "args": ["--mcp"] }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    /// Claude Desktop is installed (its settings folder is there)
    installed: bool,
    /// Stosufy is in its settings, pointing to this app
    connected: bool,
    /// Stosufy is in its settings but points somewhere else (an older install)
    outdated: bool,
    paths: Vec<String>,
}

fn desktop_status() -> DesktopStatus {
    let entry = server_entry().ok();
    let configs = installed_configs();
    let mut connected = !configs.is_empty();
    let mut outdated = false;
    for path in &configs {
        let server = read_json_object(path)
            .ok()
            .and_then(|config| config.get("mcpServers").and_then(|s| s.get(SERVER_NAME)).cloned());
        match server {
            Some(server) if Some(&server) == entry.as_ref() => {}
            Some(_) => {
                outdated = true;
                connected = false;
            }
            None => connected = false,
        }
    }
    DesktopStatus {
        installed: !configs.is_empty(),
        connected,
        outdated,
        paths: configs.iter().map(|path| path.to_string_lossy().into_owned()).collect(),
    }
}

/// Puts Stosufy into (or with `None` takes it out of) Claude Desktop's settings, keeping a
/// copy of them from before the first change
fn change_desktop_configs(entry: Option<Value>) -> Result<DesktopStatus, String> {
    let configs = installed_configs();
    if configs.is_empty() {
        return Err("Claude Desktop isn't installed, or wasn't opened yet.".into());
    }
    for path in &configs {
        let mut config = read_json_object(path)?;
        let servers = config.entry("mcpServers").or_insert_with(|| json!({}));
        if !servers.is_object() {
            *servers = json!({});
        }
        let servers = servers.as_object_mut().expect("an object");
        match &entry {
            Some(entry) => {
                servers.insert(SERVER_NAME.into(), entry.clone());
            }
            None => {
                servers.remove(SERVER_NAME);
            }
        }
        let backup = path.with_file_name(format!("{CLAUDE_CONFIG}.before-stosufy"));
        if path.exists() && !backup.exists() {
            fs::copy(path, &backup).map_err(|error| format!("Could not keep a copy: {error}"))?;
        }
        let text = serde_json::to_string_pretty(&Value::Object(config)).map_err(|e| e.to_string())?;
        write_atomically(path, text.as_bytes())
            .map_err(|error| format!("Could not change {}: {error}", path.display()))?;
    }
    Ok(desktop_status())
}

#[tauri::command]
pub fn mcp_claude_desktop() -> DesktopStatus {
    desktop_status()
}

#[tauri::command]
pub fn mcp_connect_claude_desktop() -> Result<DesktopStatus, String> {
    change_desktop_configs(Some(server_entry()?))
}

#[tauri::command]
pub fn mcp_disconnect_claude_desktop() -> Result<DesktopStatus, String> {
    change_desktop_configs(None)
}

/// Whether Claude Code has Stosufy (`claude mcp add --scope user`, kept in ~/.claude.json)
fn claude_code_connected() -> bool {
    dirs::home_dir()
        .map(|home| home.join(".claude.json"))
        .and_then(|file| read_json_object(&file).ok())
        .is_some_and(|config| config.get("mcpServers").and_then(|s| s.get(SERVER_NAME)).is_some())
}

// --- The bridge Claude starts ---------------------------------------------------------------

enum PostError {
    /// Nothing answers there (the app isn't open), or something else does
    Unreachable,
    Failed(String),
}

/// Sends a message to the app's server, returns its answer
fn post(port: u16, token: &str, body: &str) -> Result<Value, PostError> {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
        .map_err(|_| PostError::Unreachable)?;
    let _ = stream.set_read_timeout(Some(CALL_TIMEOUT + Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let request = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).map_err(|_| PostError::Unreachable)?;
    let mut response = Vec::new();
    if let Err(error) = stream.read_to_end(&mut response) {
        return Err(PostError::Failed(format!("Stosufy didn't answer: {error}")));
    }
    let split = response.windows(4).position(|window| window == b"\r\n\r\n");
    let Some(split) = split else {
        return Err(PostError::Unreachable);
    };
    let head = String::from_utf8_lossy(&response[..split]);
    let status: u16 = head.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    match status {
        200 => serde_json::from_slice(&response[split + 4..])
            .map_err(|_| PostError::Failed("Stosufy's answer couldn't be read.".into())),
        // (a port from before that some other program has now)
        401 | 403 | 404 => Err(PostError::Unreachable),
        _ => Err(PostError::Failed(format!("Stosufy answered with HTTP {status}."))),
    }
}

/// Opens the app in the background (minimized), so the call can go on
fn launch_app() -> io::Result<()> {
    let exe = app_executable()?;
    #[cfg(target_os = "macos")]
    if let Some(bundle) = exe.ancestors().nth(3).filter(|p| p.extension().is_some_and(|e| e == "app")) {
        Command::new("open").arg("-g").arg(bundle).args(["--args", "--background"]).spawn()?;
        return Ok(());
    }
    let mut command = Command::new(&exe);
    command.arg("--background").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // (its own group: it stays open when Claude ends the bridge)
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        // Out of Claude's job, so it stays open when Claude ends the bridge (where the job lets it)
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB);
        if command.spawn().is_ok() {
            return Ok(());
        }
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn().map(|_| ())
}

/// When the bridge opened the app (it isn't opened twice while it starts)
static LAUNCHED: Mutex<Option<Instant>> = Mutex::new(None);

/// A tool call from Claude: to the app, which is opened first if it isn't open
fn call_app(name: &str, arguments: Value) -> Value {
    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": name, "arguments": arguments }
    })
    .to_string();
    let started = Instant::now();
    loop {
        let connection = read_connection();
        if !connection.enabled {
            return tool_error(TURNED_OFF);
        }
        if let Some(port) = connection.port {
            match post(port, &connection.token, &request) {
                Ok(response) => {
                    return match response.get("result") {
                        Some(result) => result.clone(),
                        None => tool_error(
                            response["error"]["message"].as_str().unwrap_or("Stosufy couldn't do it."),
                        ),
                    };
                }
                Err(PostError::Failed(message)) => return tool_error(&message),
                Err(PostError::Unreachable) => {}
            }
        }
        {
            let mut launched = LAUNCHED.lock().unwrap();
            if launched.is_none_or(|at| at.elapsed() > LAUNCH_WAIT) {
                if let Err(error) = launch_app() {
                    return tool_error(&format!("Stosufy isn't open and couldn't be opened ({error}). Ask the user to open it."));
                }
                *launched = Some(Instant::now());
            }
        }
        if started.elapsed() > LAUNCH_WAIT {
            return tool_error("Stosufy isn't open, and it didn't start in time. Ask the user to open it and try again.");
        }
        thread::sleep(Duration::from_millis(500));
    }
}

/// `Stosufy --mcp`: the MCP server Claude starts, on stdin and stdout (one message a line)
pub fn run_bridge() {
    let out = Arc::new(Mutex::new(io::stdout()));
    let send = |out: &Mutex<io::Stdout>, message: Value| {
        let mut out = out.lock().unwrap();
        let _ = writeln!(out, "{message}");
        let _ = out.flush();
    };
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let message: Value = match serde_json::from_str(&line) {
            Ok(message) => message,
            Err(_) => {
                send(&out, rpc_error(Value::Null, -32700, "Parse error"));
                continue;
            }
        };
        // Tool calls each on their own: Claude may ask for several at once, and one waiting
        // for the app holds up nothing else
        let is_call = message["method"] == "tools/call" || message.is_array();
        let out = out.clone();
        let work = move || {
            if let Some(reply) = answer(&message, &call_app) {
                send(&out, reply);
            }
        };
        if is_call {
            thread::spawn(work);
        } else {
            work();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn echo(name: &str, arguments: Value) -> Value {
        json!({ "content": [{ "type": "text", "text": format!("{name} {arguments}") }] })
    }

    #[test]
    fn every_tool_says_what_it_does() {
        assert!(tools().len() >= 15);
        let mut names = HashSet::new();
        for tool in tools() {
            let name = tool["name"].as_str().unwrap();
            assert!(names.insert(name), "{name} twice");
            assert!(tool["description"].as_str().unwrap().len() > 40, "{name}");
            assert_eq!(tool["inputSchema"]["type"], "object", "{name}");
            assert!(tool["annotations"]["readOnlyHint"].is_boolean(), "{name}");
        }
        assert!(read_only("search_osu"));
        assert!(!read_only("create_playlist"));
        assert!(!read_only("no_such_tool"));
    }

    #[test]
    fn initializes_with_a_version_the_client_knows() {
        let reply = answer(
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2024-11-05" } }),
            &echo,
        )
        .unwrap();
        assert_eq!(reply["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(reply["result"]["serverInfo"]["name"], "stosufy");
        assert!(reply["result"]["capabilities"]["tools"].is_object());
        let newer = answer(
            &json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": { "protocolVersion": "2099-01-01" } }),
            &echo,
        )
        .unwrap();
        assert_eq!(newer["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
    }

    #[test]
    fn answers_requests_but_not_notifications() {
        assert!(answer(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), &echo).is_none());
        let unknown = answer(&json!({ "jsonrpc": "2.0", "id": 3, "method": "nope" }), &echo).unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
        let list = answer(&json!({ "jsonrpc": "2.0", "id": "a", "method": "tools/list" }), &echo).unwrap();
        assert_eq!(list["id"], "a");
        assert_eq!(list["result"]["tools"].as_array().unwrap().len(), tools().len());
        let batch = answer(
            &json!([{ "jsonrpc": "2.0", "id": 1, "method": "ping" }, { "jsonrpc": "2.0", "method": "x" }]),
            &echo,
        )
        .unwrap();
        assert_eq!(batch.as_array().unwrap().len(), 1);
    }

    #[test]
    fn passes_tool_calls_on() {
        let reply = answer(
            &json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "search_osu", "arguments": { "query": "camellia" } } }),
            &echo,
        )
        .unwrap();
        assert_eq!(reply["result"]["content"][0]["text"], "search_osu {\"query\":\"camellia\"}");
        let unknown = answer(
            &json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "rm_rf" } }),
            &echo,
        )
        .unwrap();
        assert_eq!(unknown["error"]["code"], -32602);
    }

    #[test]
    fn fills_in_prompts() {
        let list = prompt_list();
        assert!(list.iter().all(|prompt| prompt.get("template").is_none()));
        let filled = get_prompt(&json!({ "name": "playlist_from_my_listening", "arguments": { "size": "25" } })).unwrap();
        let text = filled["messages"][0]["content"]["text"].as_str().unwrap();
        assert!(text.contains("about 25 songs"));
        assert!(text.contains("the last 30 days"));
        assert!(!text.contains("{{"));
        assert!(get_prompt(&json!({ "name": "playlist_from_description" })).is_err());
    }

    #[test]
    fn the_server_wants_the_token_and_no_websites() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        serve(listener, "secret".into(), Arc::new(echo));
        let call = json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": "get_now_playing", "arguments": {} } }).to_string();
        match post(port, "secret", &call) {
            Ok(reply) => assert_eq!(reply["result"]["content"][0]["text"], "get_now_playing {}"),
            Err(_) => panic!("the call failed"),
        }
        assert!(matches!(post(port, "wrong", &call), Err(PostError::Unreachable)));

        // A page in a browser always says where it's from
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        write!(
            stream,
            "POST /mcp HTTP/1.1\r\nOrigin: https://example.com\r\nAuthorization: Bearer secret\r\nContent-Length: {}\r\n\r\n{call}",
            call.len()
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 403"));
    }

    #[test]
    fn the_connection_file_reads_what_it_wrote() {
        let connection = Connection { enabled: true, allow_changes: false, token: "t".into(), port: Some(1) };
        let text = serde_json::to_string(&connection).unwrap();
        assert_eq!(serde_json::from_str::<Connection>(&text).unwrap(), connection);
        // (older or partial files: changes are allowed unless turned off)
        assert!(serde_json::from_str::<Connection>("{\"enabled\":true}").unwrap().allow_changes);
        assert_eq!(new_token().len(), 48);
    }
}
