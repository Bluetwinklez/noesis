//! Model Context Protocol connection for external AI assistants.
//!
//! The app hosts a local endpoint on 127.0.0.1 (`POST /mcp`, JSON-RPC, bearer
//! token). Each message is handed to the WebView, where the TypeScript MCP
//! server (src/mcp/server.ts) answers it with the same repositories and approval
//! rules as the UI. AI clients that speak stdio launch `noesis --mcp`, a small
//! bridge that forwards stdin lines to the endpoint and starts Noesis if needed.
//!
//! Connection details live in `<app data>/mcp.json` (port + token); only the
//! local user can read it, and requests carrying an `Origin` header are refused
//! unless they come from a browser extension (the Noesis web clipper), which
//! still needs the token. Web pages can never reach the endpoint.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};
use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

pub const PREFERRED_PORT: u16 = 47816;
const MAX_BODY: usize = 4 * 1024 * 1024;
/// Long enough for the user to read and approve a change request.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(180);
pub const IDENTIFIER: &str = "app.noesis.desktop";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
}

/// Answers forwarded messages. In the app this emits an event to the WebView;
/// tests plug in a stub.
pub trait Forwarder: Send + Sync + 'static {
    fn forward(&self, request_id: u64, client: &str, message: &str);
}

#[derive(Default)]
pub struct Shared {
    pending: Mutex<HashMap<u64, mpsc::Sender<String>>>,
    sessions: Mutex<HashMap<String, String>>,
    next: AtomicU64,
}

impl Shared {
    /// Delivers the WebView's answer to the waiting HTTP request.
    pub fn respond(&self, request_id: u64, body: String) -> bool {
        match self.pending.lock().unwrap().remove(&request_id) {
            Some(tx) => tx.send(body).is_ok(),
            None => false,
        }
    }
}

pub struct Server {
    pub endpoint: Endpoint,
    http: Arc<tiny_http::Server>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.http.unblock();
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn header<'a>(req: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

/// Browser-extension origins cannot be used by web pages, so they may call the endpoint (with the token).
fn extension_origin(origin: &str) -> bool {
    origin.len() < 200 && ["chrome-extension://", "moz-extension://", "safari-web-extension://"].iter().any(|p| origin.starts_with(p))
}

fn reply(req: tiny_http::Request, status: u16, body: &str, session: Option<&str>, cors: Option<&str>) {
    let mut res = tiny_http::Response::from_string(body).with_status_code(status);
    if let Some(origin) = cors {
        for (k, v) in [
            ("Access-Control-Allow-Origin", origin),
            ("Access-Control-Allow-Headers", "authorization, content-type, mcp-session-id"),
            ("Access-Control-Allow-Methods", "POST"),
            ("Access-Control-Expose-Headers", "Mcp-Session-Id"),
            ("Vary", "Origin"),
        ] {
            res.add_header(tiny_http::Header::from_bytes(k, v).unwrap());
        }
    }
    if !body.is_empty() {
        res.add_header(tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap());
    }
    if let Some(s) = session {
        res.add_header(tiny_http::Header::from_bytes("Mcp-Session-Id", s).unwrap());
    }
    let _ = req.respond(res);
}

fn rpc_error(id: &Json, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

fn handle(mut req: tiny_http::Request, token: &str, shared: &Shared, fwd: &dyn Forwarder) {
    let cors = header(&req, "Origin").map(str::to_string);
    let cors = cors.as_deref();
    if req.url() != "/mcp" {
        return reply(req, 404, "", None, None);
    }
    // Browsers always send Origin; MCP clients do not. This blocks web pages
    // (including DNS-rebinding attacks) from talking to the local endpoint.
    if cors.is_some_and(|o| !extension_origin(o)) {
        return reply(req, 403, "", None, None);
    }
    if *req.method() == tiny_http::Method::Options && cors.is_some() {
        return reply(req, 204, "", None, cors);
    }
    let auth_ok = header(&req, "Authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|t| constant_time_eq(t.as_bytes(), token.as_bytes()));
    if !auth_ok {
        return reply(req, 401, "", None, cors);
    }
    if *req.method() != tiny_http::Method::Post {
        return reply(req, 405, "", None, cors);
    }
    let mut body = String::new();
    if req.as_reader().take(MAX_BODY as u64 + 1).read_to_string(&mut body).is_err() || body.len() > MAX_BODY {
        return reply(req, 413, "", None, cors);
    }
    let msg: Json = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return reply(req, 400, &rpc_error(&Json::Null, -32700, "Parse error"), None, cors),
    };
    if !msg.is_object() {
        return reply(req, 400, &rpc_error(&Json::Null, -32600, "Batch requests are not supported"), None, cors);
    }
    let id = msg.get("id").cloned().unwrap_or(Json::Null);
    let is_initialize = msg.get("method").and_then(Json::as_str) == Some("initialize");
    let mut new_session = None;
    let client = if is_initialize {
        let name = msg.pointer("/params/clientInfo/title").or_else(|| msg.pointer("/params/clientInfo/name")).and_then(Json::as_str).unwrap_or("AI assistant");
        let name: String = name.chars().filter(|c| !c.is_control()).take(60).collect();
        let sid = uuid::Uuid::new_v4().to_string();
        shared.sessions.lock().unwrap().insert(sid.clone(), name.clone());
        new_session = Some(sid);
        name
    } else {
        header(&req, "Mcp-Session-Id")
            .and_then(|s| shared.sessions.lock().unwrap().get(s).cloned())
            .unwrap_or_else(|| "AI assistant".to_string())
    };
    let rid = shared.next.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, rx) = mpsc::channel();
    shared.pending.lock().unwrap().insert(rid, tx);
    fwd.forward(rid, &client, &body);
    match rx.recv_timeout(RESPONSE_TIMEOUT) {
        // Notifications get no JSON-RPC response.
        Ok(answer) if answer.is_empty() => reply(req, 202, "", new_session.as_deref(), cors),
        Ok(answer) => reply(req, 200, &answer, new_session.as_deref(), cors),
        Err(_) => {
            shared.pending.lock().unwrap().remove(&rid);
            reply(req, 200, &rpc_error(&id, -32001, "Noesis did not answer in time (is the app busy or waiting for approval?)"), None, cors)
        }
    }
}

pub fn start(endpoint_file: &Path, token: String, shared: Arc<Shared>, fwd: Arc<dyn Forwarder>) -> Result<Server, String> {
    let http = tiny_http::Server::http(("127.0.0.1", PREFERRED_PORT))
        .or_else(|_| tiny_http::Server::http(("127.0.0.1", 0)))
        .map_err(|e| format!("Could not open the local AI connection port: {e}"))?;
    let port = http.server_addr().to_ip().map(|a| a.port()).ok_or("no port")?;
    let http = Arc::new(http);
    let endpoint = Endpoint { port, token: token.clone() };
    crate::files::atomic_write(endpoint_file, serde_json::to_string_pretty(&endpoint).unwrap().as_bytes())?;
    let srv = http.clone();
    let worker = std::thread::spawn(move || {
        for req in srv.incoming_requests() {
            let (token, shared, fwd) = (token.clone(), shared.clone(), fwd.clone());
            std::thread::spawn(move || handle(req, &token, &shared, fwd.as_ref()));
        }
    });
    Ok(Server { endpoint, http, worker: Some(worker) })
}

/// Same location Tauri's `app_data_dir()` uses for this app.
pub fn app_data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")));
    base.map(|b| b.join(IDENTIFIER))
}

pub fn endpoint_file(data_dir: &Path) -> PathBuf {
    data_dir.join("mcp.json")
}

// ---------------------------------------------------------------- stdio bridge

fn post(ep: &Endpoint, body: &str, session: Option<&str>) -> std::io::Result<(u16, Option<String>, String)> {
    let addr = SocketAddr::from(([127, 0, 0, 1], ep.port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(2))?;
    s.set_read_timeout(Some(RESPONSE_TIMEOUT + Duration::from_secs(10)))?;
    let mut head = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n",
        ep.port,
        ep.token,
        body.len()
    );
    if let Some(sid) = session {
        head.push_str(&format!("Mcp-Session-Id: {sid}\r\n"));
    }
    head.push_str("\r\n");
    s.write_all(head.as_bytes())?;
    s.write_all(body.as_bytes())?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw)?;
    let text = String::from_utf8_lossy(&raw);
    let (head, rest) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let status = head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    let sid = head
        .lines()
        .find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("mcp-session-id")).map(|(_, v)| v.trim().to_string()));
    let is_chunked = head.lines().any(|l| l.to_ascii_lowercase().starts_with("transfer-encoding:") && l.to_ascii_lowercase().contains("chunked"));
    let body = if is_chunked { dechunk(rest) } else { rest.to_string() };
    Ok((status, sid, body))
}

fn dechunk(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some((size, after)) = rest.split_once("\r\n") {
        let n = usize::from_str_radix(size.trim(), 16).unwrap_or(0);
        if n == 0 || after.len() < n {
            break;
        }
        out.push_str(&after[..n]);
        rest = after[n..].trim_start_matches("\r\n");
    }
    out
}

fn read_endpoint(file: &Path) -> Option<Endpoint> {
    serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()
}

/// Starts the Noesis window (same executable, no `--mcp`) and waits for its endpoint.
fn launch_app_and_wait(file: &Path) -> Option<Endpoint> {
    let exe = std::env::current_exe().ok()?;
    std::process::Command::new(exe).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).spawn().ok()?;
    for _ in 0..60 {
        std::thread::sleep(Duration::from_millis(500));
        if let Some(ep) = read_endpoint(file) {
            if TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], ep.port)), Duration::from_millis(300)).is_ok() {
                return Some(ep);
            }
        }
    }
    None
}

/// `noesis --mcp`: newline-delimited JSON-RPC on stdin/stdout, forwarded to the running app.
pub fn run_bridge(data_dir: &Path, input: impl BufRead, mut output: impl Write, allow_launch: bool) {
    let file = endpoint_file(data_dir);
    let mut session: Option<String> = None;
    let mut launched = false;
    for line in input.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let id = serde_json::from_str::<Json>(&line).ok().and_then(|v| v.get("id").cloned());
        let mut attempt = read_endpoint(&file).map(|ep| post(&ep, &line, session.as_deref()));
        if !matches!(attempt, Some(Ok(_))) && allow_launch && !launched && file.exists() {
            launched = true;
            attempt = launch_app_and_wait(&file).map(|ep| post(&ep, &line, session.as_deref()));
        }
        let answer = match attempt {
            Some(Ok((200, sid, body))) => {
                if sid.is_some() {
                    session = sid;
                }
                Some(body)
            }
            Some(Ok((202, _, _))) => None,
            Some(Ok((401, _, _))) => id.map(|id| rpc_error(&id, -32002, "Noesis rejected the connection token. Reconnect this assistant from Noesis → Settings → AI connections.")),
            _ => id.map(|id| {
                rpc_error(&id, -32000, "Noesis is not running or AI connections are turned off. Open Noesis and enable Settings → AI connections.")
            }),
        };
        if let Some(a) = answer {
            if writeln!(output, "{}", a.trim()).is_err() || output.flush().is_err() {
                break;
            }
        }
    }
}

// ------------------------------------------------------ one-click client setup

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientTarget {
    pub id: &'static str,
    pub name: &'static str,
    pub path: Option<String>,
    pub installed: bool,
    pub connected: bool,
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Config files that use the common `{ "mcpServers": { name: { command, args } } }` shape.
fn client_config_paths(id: &str) -> Vec<PathBuf> {
    let Some(home) = home() else { return vec![] };
    match id {
        "claude-desktop" => {
            let mut v = Vec::new();
            #[cfg(windows)]
            {
                // Microsoft Store build keeps its data in a virtualised folder.
                if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                    // Current builds keep settings in %LOCALAPPDATA%\Claude-Data\claude_<package>\.
                    if let Ok(entries) = std::fs::read_dir(PathBuf::from(&local).join("Claude-Data")) {
                        for e in entries.flatten() {
                            if e.file_name().to_string_lossy().starts_with("claude_") && e.path().is_dir() {
                                v.push(e.path().join("claude_desktop_config.json"));
                            }
                        }
                    }
                    if let Ok(entries) = std::fs::read_dir(PathBuf::from(local).join("Packages")) {
                        for e in entries.flatten() {
                            if e.file_name().to_string_lossy().starts_with("Claude_") {
                                v.push(e.path().join("LocalCache").join("Roaming").join("Claude").join("claude_desktop_config.json"));
                            }
                        }
                    }
                }
                // Older builds.
                if let Some(appdata) = std::env::var_os("APPDATA") {
                    v.push(PathBuf::from(appdata).join("Claude").join("claude_desktop_config.json"));
                }
            }
            #[cfg(target_os = "macos")]
            v.push(home.join("Library/Application Support/Claude/claude_desktop_config.json"));
            #[cfg(all(unix, not(target_os = "macos")))]
            v.push(home.join(".config/Claude/claude_desktop_config.json"));
            v
        }
        "cursor" => vec![home.join(".cursor").join("mcp.json")],
        "windsurf" => vec![home.join(".codeium").join("windsurf").join("mcp_config.json")],
        "lm-studio" => vec![home.join(".lmstudio").join("mcp.json")],
        _ => vec![],
    }
}

pub const CLIENTS: [(&str, &str); 4] = [("claude-desktop", "Claude Desktop"), ("cursor", "Cursor"), ("windsurf", "Windsurf"), ("lm-studio", "LM Studio")];

pub fn client_status() -> Vec<ClientTarget> {
    CLIENTS
        .iter()
        .map(|(id, name)| {
            let paths = client_config_paths(id);
            // A client counts as installed when its config folder exists.
            let installed_path = paths.iter().find(|p| p.parent().is_some_and(Path::is_dir)).or(paths.first());
            let connected = paths.iter().any(|p| {
                std::fs::read_to_string(p)
                    .ok()
                    .and_then(|s| serde_json::from_str::<Json>(&s).ok())
                    .is_some_and(|v| v.pointer("/mcpServers/noesis").is_some())
            });
            ClientTarget {
                id,
                name,
                path: installed_path.map(|p| p.to_string_lossy().into_owned()),
                installed: paths.iter().any(|p| p.parent().is_some_and(Path::is_dir)),
                connected,
            }
        })
        .collect()
}

/// Adds (or removes) the Noesis entry in a client's MCP config, keeping every
/// other setting. The previous file is kept as `<name>.noesis-backup`.
pub fn set_client(id: &str, connect: bool, exe: &Path) -> Result<Vec<String>, String> {
    let paths: Vec<PathBuf> = client_config_paths(id).into_iter().filter(|p| p.parent().is_some_and(Path::is_dir)).collect();
    if paths.is_empty() {
        return Err("This app does not seem to be installed for the current user (its settings folder was not found).".into());
    }
    let mut written = Vec::new();
    for path in paths {
        let mut cfg: Json = match std::fs::read_to_string(&path) {
            Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s).map_err(|_| format!("{} is not valid JSON; fix or remove it first.", path.display()))?,
            _ => json!({}),
        };
        if !cfg.is_object() {
            return Err(format!("{} does not contain a JSON object.", path.display()));
        }
        if path.exists() {
            let backup = path.with_extension("json.noesis-backup");
            std::fs::copy(&path, &backup).map_err(|e| e.to_string())?;
        }
        let servers = cfg.as_object_mut().unwrap().entry("mcpServers").or_insert_with(|| json!({}));
        if !servers.is_object() {
            *servers = json!({});
        }
        let servers = servers.as_object_mut().unwrap();
        if connect {
            servers.insert("noesis".into(), json!({ "command": exe.to_string_lossy(), "args": ["--mcp"] }));
        } else {
            servers.remove("noesis");
        }
        let text = serde_json::to_string_pretty(&cfg).unwrap() + "\n";
        crate::files::atomic_write(&path, text.as_bytes())?;
        written.push(path.to_string_lossy().into_owned());
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Answers like the WebView would: echoes the method name, or nothing for notifications.
    struct Echo(Arc<Shared>);
    impl Forwarder for Echo {
        fn forward(&self, rid: u64, client: &str, message: &str) {
            let v: Json = serde_json::from_str(message).unwrap();
            let body = match v.get("id") {
                Some(id) => json!({ "jsonrpc": "2.0", "id": id, "result": { "method": v["method"], "client": client } }).to_string(),
                None => String::new(),
            };
            self.0.respond(rid, body);
        }
    }

    fn server(dir: &Path) -> (Server, Arc<Shared>) {
        let shared = Arc::new(Shared::default());
        let srv = start(&endpoint_file(dir), "secret-token".into(), shared.clone(), Arc::new(Echo(shared.clone()))).unwrap();
        (srv, shared)
    }

    #[test]
    fn endpoint_requires_token_and_refuses_browsers() {
        let dir = tempfile::tempdir().unwrap();
        let (srv, _) = server(dir.path());
        let ep = srv.endpoint.clone();
        let (status, _, _) = post(&Endpoint { token: "wrong".into(), ..ep.clone() }, r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#, None).unwrap();
        assert_eq!(status, 401);
        // Same request but with an Origin header, as a web page would send.
        let mut s = TcpStream::connect(("127.0.0.1", ep.port)).unwrap();
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
        write!(s, "POST /mcp HTTP/1.1\r\nHost: x\r\nOrigin: https://evil.example\r\nAuthorization: Bearer secret-token\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        assert!(out.starts_with("HTTP/1.1 403"), "{out}");
        // The browser extension (web clipper) is let through, with CORS headers, but still needs the token.
        for (token, expect) in [("secret-token", "HTTP/1.1 200"), ("wrong", "HTTP/1.1 401")] {
            let mut s = TcpStream::connect(("127.0.0.1", ep.port)).unwrap();
            write!(s, "POST /mcp HTTP/1.1\r\nHost: x\r\nOrigin: chrome-extension://abcdef\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).unwrap();
            assert!(out.starts_with(expect), "{out}");
            assert!(out.to_ascii_lowercase().contains("access-control-allow-origin: chrome-extension://abcdef"), "{out}");
        }
        let (status, _, body) = post(&ep, r#"{"jsonrpc":"2.0","id":7,"method":"ping"}"#, None).unwrap();
        assert_eq!(status, 200);
        assert!(body.contains("\"id\":7"));
    }

    #[test]
    fn bridge_forwards_lines_and_tracks_the_client_session() {
        let dir = tempfile::tempdir().unwrap();
        let (_srv, _) = server(dir.path());
        let input = concat!(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"claude-ai","title":"Claude"}}}"#, "\n",
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#, "\n",
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#, "\n",
        );
        let mut out = Vec::new();
        run_bridge(dir.path(), Cursor::new(input), &mut out, false);
        let lines: Vec<Json> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.len(), 2, "notification produces no output");
        assert_eq!(lines[0]["result"]["method"], "initialize");
        assert_eq!(lines[1]["result"]["method"], "tools/list");
        assert_eq!(lines[1]["result"]["client"], "Claude", "session carries the client name");
    }

    #[test]
    fn bridge_reports_when_the_app_is_not_running() {
        let dir = tempfile::tempdir().unwrap();
        let mut out = Vec::new();
        run_bridge(dir.path(), Cursor::new("{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/list\"}\n"), &mut out, false);
        let v: Json = serde_json::from_str(String::from_utf8(out).unwrap().trim()).unwrap();
        assert_eq!(v["id"], 5);
        assert_eq!(v["error"]["code"], -32000);
    }

    #[test]
    fn client_config_is_merged_and_backed_up() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        std::fs::create_dir_all(home.join(".cursor")).unwrap();
        let cfg = home.join(".cursor/mcp.json");
        std::fs::write(&cfg, r#"{"mcpServers":{"other":{"command":"x"}},"theme":"dark"}"#).unwrap();
        std::env::set_var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }, home);
        set_client("cursor", true, Path::new("/opt/noesis/noesis")).unwrap();
        let v: Json = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(v["mcpServers"]["noesis"]["args"][0], "--mcp");
        assert_eq!(v["mcpServers"]["other"]["command"], "x");
        assert_eq!(v["theme"], "dark");
        assert!(home.join(".cursor/mcp.json.noesis-backup").exists());
        assert!(client_status().iter().any(|c| c.id == "cursor" && c.connected));
        set_client("cursor", false, Path::new("/opt/noesis/noesis")).unwrap();
        let v: Json = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert!(v["mcpServers"].get("noesis").is_none());
        assert!(set_client("windsurf", true, Path::new("x")).is_err(), "not installed");
    }
}
