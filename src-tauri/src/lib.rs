mod db;
mod files;
mod mcp;
mod net;

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value as Json;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

const KEYRING_SERVICE: &str = "app.noesis.desktop";

struct AppState {
    conn: Mutex<Connection>,
    data_dir: PathBuf,
    db_path: PathBuf,
    attachments_dir: PathBuf,
    recovered_from: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    data_dir: String,
    version: String,
    db_path: String,
    db_bytes: u64,
    attachments_bytes: u64,
    recovered_from: Option<String>,
}

#[tauri::command]
fn db_exec(state: State<'_, AppState>, sql: String, params: Vec<Json>) -> Result<db::ExecResult, String> {
    let conn = state.conn.lock().map_err(|_| "database lock poisoned")?;
    db::exec(&conn, &sql, &params)
}

#[tauri::command]
fn db_integrity(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().map_err(|_| "database lock poisoned")?;
    let mut stmt = conn.prepare("PRAGMA integrity_check").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Consistent native snapshot of the database file (VACUUM INTO).
#[tauri::command]
fn db_snapshot(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = files::validate_user_path(&path, &["db"])?;
    if p.exists() {
        return Err("target file already exists".into());
    }
    let conn = state.conn.lock().map_err(|_| "database lock poisoned")?;
    db::unguarded(&conn, |c| c.execute("VACUUM INTO ?1", [p.to_string_lossy().to_string()])).map_err(|e| e.to_string())?;
    Ok(())
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    if !files::valid_secret_key(key) {
        return Err("invalid secret key name".into());
    }
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("credential store error: {e}")),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    if value.len() > 4096 {
        return Err("secret too long".into());
    }
    entry(&key)?.set_password(&value).map_err(|e| format!("credential store error: {e}"))
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("credential store error: {e}")),
    }
}

#[tauri::command]
fn attachment_write(state: State<'_, AppState>, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > files::MAX_ATTACHMENT_BYTES {
        return Err("file exceeds the 200 MB attachment limit".into());
    }
    let key = format!("{}-{}", uuid::Uuid::new_v4(), files::sanitize_file_name(&file_name));
    let path = files::resolve_in(&state.attachments_dir, &key)?;
    files::atomic_write(&path, &bytes)?;
    Ok(key)
}

#[tauri::command]
fn attachment_read(state: State<'_, AppState>, key: String) -> Result<Vec<u8>, String> {
    let path = files::resolve_in(&state.attachments_dir, &key)?;
    std::fs::read(path).map_err(|e| format!("attachment unavailable: {e}"))
}

#[tauri::command]
fn attachment_delete(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let path = files::resolve_in(&state.attachments_dir, &key)?;
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(serde::Deserialize)]
struct SaveFilter {
    name: String,
    extensions: Vec<String>,
}

/// Shows the native save dialog and writes the export to the chosen file.
/// The path never comes from the WebView, so page script cannot pick an
/// arbitrary file to overwrite. Returns None when the user cancels.
#[tauri::command]
async fn export_save(app: tauri::AppHandle, default_name: String, filters: Vec<SaveFilter>, bytes: Vec<u8>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_file_name(files::sanitize_file_name(&default_name));
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }
    let Some(chosen) = dialog.blocking_save_file() else { return Ok(None) };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    let p = files::validate_user_path(&path.to_string_lossy(), files::EXPORT_EXTENSIONS)?;
    files::atomic_write(&p, &bytes)?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

/// Downloads a user-supplied web page for import; local and private networks are refused at every hop.
#[tauri::command]
async fn fetch_public_url(url: String) -> Result<net::FetchedUrl, String> {
    net::fetch_public(&url).await
}

// ------------------------------------------------------------ AI connections (MCP)

#[derive(Default)]
struct McpState {
    shared: std::sync::Arc<mcp::Shared>,
    server: Mutex<Option<mcp::Server>>,
}

struct EventForwarder(tauri::AppHandle);

impl mcp::Forwarder for EventForwarder {
    fn forward(&self, request_id: u64, client: &str, message: &str) {
        use tauri::Emitter;
        let _ = self.0.emit("mcp-request", serde_json::json!({ "rid": request_id, "client": client, "message": message }));
    }
}

#[derive(Serialize)]
struct McpStatus {
    running: bool,
    port: Option<u16>,
    exe: String,
}

/// Token shared with AI clients through mcp.json; created once, kept across restarts.
fn mcp_token(data_dir: &std::path::Path) -> Result<String, String> {
    let file = data_dir.join("mcp-token");
    if let Ok(t) = std::fs::read_to_string(&file) {
        if t.trim().len() >= 32 {
            return Ok(t.trim().to_string());
        }
    }
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    files::atomic_write(&file, token.as_bytes())?;
    Ok(token)
}

#[tauri::command]
fn mcp_start(app: tauri::AppHandle, state: State<'_, AppState>, mcp_state: State<'_, McpState>) -> Result<McpStatus, String> {
    let mut server = mcp_state.server.lock().map_err(|_| "lock poisoned")?;
    if server.is_none() {
        let token = mcp_token(&state.data_dir)?;
        *server = Some(mcp::start(&mcp::endpoint_file(&state.data_dir), token, mcp_state.shared.clone(), std::sync::Arc::new(EventForwarder(app)))?);
    }
    Ok(McpStatus { running: true, port: server.as_ref().map(|s| s.endpoint.port), exe: exe_path() })
}

#[tauri::command]
fn mcp_stop(state: State<'_, AppState>, mcp_state: State<'_, McpState>) -> Result<(), String> {
    mcp_state.server.lock().map_err(|_| "lock poisoned")?.take();
    // Without the endpoint file the stdio bridge will not auto-start the app either.
    match std::fs::remove_file(mcp::endpoint_file(&state.data_dir)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[tauri::command]
fn mcp_status(mcp_state: State<'_, McpState>) -> McpStatus {
    let server = mcp_state.server.lock().ok();
    let port = server.as_ref().and_then(|s| s.as_ref().map(|s| s.endpoint.port));
    McpStatus { running: port.is_some(), port, exe: exe_path() }
}

#[tauri::command]
fn mcp_respond(mcp_state: State<'_, McpState>, rid: u64, body: String) -> bool {
    mcp_state.shared.respond(rid, body)
}

#[tauri::command]
fn mcp_clients() -> Vec<mcp::ClientTarget> {
    mcp::client_status()
}

#[tauri::command]
fn mcp_connect_client(id: String, connect: bool) -> Result<Vec<String>, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    mcp::set_client(&id, connect, &exe)
}

fn exe_path() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

/// `noesis --mcp`: stdio bridge used by AI clients (no window is opened).
pub fn run_mcp_bridge() {
    let Some(dir) = mcp::app_data_dir() else {
        eprintln!("Noesis: cannot locate the app data folder");
        return;
    };
    let stdin = std::io::stdin();
    mcp::run_bridge(&dir, stdin.lock(), std::io::stdout().lock(), true);
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<AppInfo, String> {
    let db_bytes = std::fs::metadata(&state.db_path).map(|m| m.len()).unwrap_or(0)
        + std::fs::metadata(state.db_path.with_extension("db-wal")).map(|m| m.len()).unwrap_or(0);
    Ok(AppInfo {
        data_dir: state.data_dir.to_string_lossy().into(),
        version: app.package_info().version.to_string(),
        db_path: state.db_path.to_string_lossy().into(),
        db_bytes,
        attachments_bytes: files::dir_size(&state.attachments_dir),
        recovered_from: state.recovered_from.clone(),
    })
}

/// Opens the database; a corrupt file is moved aside (never deleted) and a fresh one created.
fn open_database(db_path: &PathBuf) -> Result<(Connection, Option<String>), String> {
    match db::open(db_path) {
        Ok(conn) if db::quick_check(&conn).unwrap_or(false) => Ok((conn, None)),
        result => {
            drop(result);
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let moved = db_path.with_extension(format!("db.corrupt-{stamp}"));
            if db_path.exists() {
                std::fs::rename(db_path, &moved).map_err(|e| format!("could not move corrupt database aside: {e}"))?;
                for ext in ["db-wal", "db-shm"] {
                    let side = db_path.with_extension(ext);
                    if side.exists() {
                        let _ = std::fs::rename(&side, moved.with_extension(format!("{ext}.corrupt")));
                    }
                }
            }
            let conn = db::open(db_path).map_err(|e| e.to_string())?;
            Ok((conn, Some(moved.to_string_lossy().into())))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init());
    }
    builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let attachments_dir = data_dir.join("attachments");
            std::fs::create_dir_all(&attachments_dir)?;
            let db_path = data_dir.join("noesis.db");
            let (conn, recovered_from) = open_database(&db_path).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(McpState::default());
            app.manage(AppState { conn: Mutex::new(conn), data_dir, db_path, attachments_dir, recovered_from });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_exec,
            db_integrity,
            db_snapshot,
            secret_get,
            secret_set,
            secret_delete,
            attachment_write,
            attachment_read,
            attachment_delete,
            export_save,
            fetch_public_url,
            mcp_start,
            mcp_stop,
            mcp_status,
            mcp_respond,
            mcp_clients,
            mcp_connect_client,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Noesis");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_database_is_moved_aside() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("noesis.db");
        std::fs::write(&p, b"this is definitely not a sqlite database file, just garbage bytes.......").unwrap();
        let (conn, recovered) = open_database(&p).unwrap();
        assert!(recovered.is_some());
        assert!(std::path::Path::new(&recovered.unwrap()).exists());
        assert!(db::quick_check(&conn).unwrap());
    }

    #[test]
    fn healthy_database_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("noesis.db");
        {
            let (c, _) = open_database(&p).unwrap();
            c.execute_batch("CREATE TABLE keep (x); INSERT INTO keep VALUES (1);").unwrap();
        }
        let (c, recovered) = open_database(&p).unwrap();
        assert!(recovered.is_none());
        let n: i64 = c.query_row("SELECT COUNT(*) FROM keep", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }
}
