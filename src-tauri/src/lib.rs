mod db;
mod files;
mod mcp;
mod net;
mod recovery;

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value as Json;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};

const KEYRING_SERVICE: &str = "app.noesis.desktop";

struct AppState {
    conn: Mutex<Option<Connection>>,
    startup_error: Mutex<Option<String>>,
    data_dir: PathBuf,
    db_path: PathBuf,
    attachments_dir: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    data_dir: String,
    version: String,
    db_path: String,
    db_bytes: u64,
    attachments_bytes: u64,
    startup_error: Option<String>,
}

#[tauri::command]
fn db_exec(state: State<'_, AppState>, sql: String, params: Vec<Json>) -> Result<db::ExecResult, String> {
    let conn = state.conn.lock().map_err(|_| "database lock poisoned")?;
    db::exec(conn.as_ref().ok_or("Database unavailable; use recovery.")?, &sql, &params)
}

#[tauri::command]
fn db_integrity(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().map_err(|_| "database lock poisoned")?;
    let conn = conn.as_ref().ok_or("Database unavailable; use recovery.")?;
    let mut stmt = conn.prepare("PRAGMA integrity_check").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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

// File contents cross the IPC bridge as raw bytes, not JSON number arrays (which
// cost ~4x the size and freeze the WebView for large files). A binary message is
// `u32 LE length` + JSON metadata + payload; see `packBinary` in src/lib/platform.ts.
const MAX_IPC_META: usize = 64 * 1024;

fn split_binary<T: serde::de::DeserializeOwned>(body: &[u8]) -> Result<(T, &[u8]), String> {
    let len = body.get(..4).map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize).ok_or("malformed binary message")?;
    if len > MAX_IPC_META || body.len() < 4 + len {
        return Err("malformed binary message".into());
    }
    let meta = serde_json::from_slice(&body[4..4 + len]).map_err(|e| format!("malformed binary message: {e}"))?;
    Ok((meta, &body[4 + len..]))
}

fn raw_body<'a>(request: &'a tauri::ipc::Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => Ok(b),
        _ => Err("expected a binary message".into()),
    }
}

fn pack_binary(meta: &impl serde::Serialize, payload: &[u8]) -> Vec<u8> {
    let head = serde_json::to_vec(meta).unwrap_or_default();
    let mut out = Vec::with_capacity(4 + head.len() + payload.len());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(payload);
    out
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentMeta {
    file_name: String,
}

#[tauri::command]
fn attachment_write(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let (meta, bytes) = split_binary::<AttachmentMeta>(raw_body(&request)?)?;
    let file_name = meta.file_name;
    if bytes.len() > files::MAX_ATTACHMENT_BYTES {
        return Err("file exceeds the 200 MB attachment limit".into());
    }
    let key = format!("{}-{}", uuid::Uuid::new_v4(), files::sanitize_file_name(&file_name));
    let path = files::resolve_in(&state.attachments_dir, &key)?;
    files::atomic_write(&path, bytes)?;
    Ok(key)
}

#[tauri::command]
fn attachment_read(state: State<'_, AppState>, key: String) -> Result<tauri::ipc::Response, String> {
    let path = files::resolve_in(&state.attachments_dir, &key)?;
    std::fs::read(path).map(tauri::ipc::Response::new).map_err(|e| format!("attachment unavailable: {e}"))
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
struct AutoBackupMeta {
    keep: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoBackups {
    dir: String,
    count: usize,
}

/// Writes an automatic backup into `<app data>/backups` and keeps only the newest `keep`.
/// The folder is fixed on the Rust side: the WebView cannot choose where it goes.
#[tauri::command]
fn backup_auto_save(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<AutoBackups, String> {
    let (AutoBackupMeta { keep }, bytes) = split_binary::<AutoBackupMeta>(raw_body(&request)?)?;
    let dir = state.data_dir.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("noesis-auto-{}.noesisbak", chrono_like_stamp());
    files::atomic_write(&dir.join(name), bytes)?;
    let count = files::prune_backups(&dir, keep.clamp(1, 100))?;
    Ok(AutoBackups { dir: dir.to_string_lossy().into_owned(), count })
}

/// UTC timestamp `YYYYMMDD-HHMMSS` that sorts by time (no chrono dependency needed).
fn chrono_like_stamp() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    // Civil-from-days (Howard Hinnant), valid for all dates after 1970.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, rem / 60 % 60, rem % 60)
}

#[derive(serde::Deserialize)]
struct SaveFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveMeta {
    default_name: String,
    #[serde(default)]
    filters: Vec<SaveFilter>,
}

/// Shows the native save dialog and writes the export to the chosen file.
/// The path never comes from the WebView, so page script cannot pick an
/// arbitrary file to overwrite. Returns None when the user cancels.
#[tauri::command]
async fn export_save(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (SaveMeta { default_name, filters }, bytes) = split_binary::<SaveMeta>(raw_body(&request)?)?;
    let mut dialog = app.dialog().file().set_file_name(files::sanitize_file_name(&default_name));
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }
    let Some(chosen) = dialog.blocking_save_file() else { return Ok(None) };
    let path = chosen.into_path().map_err(|e| e.to_string())?;
    let p = files::validate_user_path(&path.to_string_lossy())?;
    files::atomic_write(&p, bytes)?;
    Ok(Some(p.to_string_lossy().into_owned()))
}

/// Downloads a user-supplied web page for import; local and private networks are refused at every hop.
#[tauri::command]
async fn fetch_public_url(url: String) -> Result<tauri::ipc::Response, String> {
    let page = net::fetch_public(&url).await?;
    Ok(tauri::ipc::Response::new(pack_binary(&page, &page.bytes)))
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
    /// Shown in Settings so the user can paste it into the web clipper extension.
    token: Option<String>,
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
    let ep = server.as_ref().map(|s| s.endpoint.clone());
    Ok(McpStatus { running: true, port: ep.as_ref().map(|e| e.port), exe: exe_path(), token: ep.map(|e| e.token) })
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
    let ep = server.as_ref().and_then(|s| s.as_ref().map(|s| s.endpoint.clone()));
    McpStatus { running: ep.is_some(), port: ep.as_ref().map(|e| e.port), exe: exe_path(), token: ep.map(|e| e.token) }
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
        startup_error: state.startup_error.lock().map_err(|_| "recovery lock poisoned")?.clone(),
    })
}

#[tauri::command]
fn recovery_install(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let (_, bytes) = split_binary::<Json>(raw_body(&request)?)?;
    let mut conn = state.conn.lock().map_err(|_| "database lock poisoned")?;
    recovery::install(&mut conn, &state.db_path, bytes)?;
    *state.startup_error.lock().map_err(|_| "recovery lock poisoned")? = None;
    Ok(())
}

#[tauri::command]
fn recovery_raw(state: State<'_, AppState>) -> Result<tauri::ipc::Response, String> {
    let _guard = state.conn.lock().map_err(|_| "database lock poisoned")?;
    let path = state.db_path.clone();
    let mut entries = Vec::new();
    let mut payload = Vec::new();
    let sidecars = [path.with_extension("db-wal"), path.with_extension("db-shm")];
    for (file, name) in [(path, "noesis.db"), (sidecars[0].clone(), "noesis.db-wal"), (sidecars[1].clone(), "noesis.db-shm")] {
        if file.exists() {
            let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
            entries.push(serde_json::json!({ "name": name, "size": bytes.len() }));
            payload.extend(bytes);
        }
    }
    if entries.is_empty() { return Err("No stored database file is available.".into()); }
    Ok(tauri::ipc::Response::new(pack_binary(&serde_json::json!({ "files": entries }), &payload)))
}

#[tauri::command]
fn recovery_open_backups(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = state.data_dir.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy().into_owned(), None::<String>).map_err(|e| e.to_string())
}

/// A corrupt database stays in place until a validated recovery replaces it.
fn open_database(db_path: &Path) -> Result<Connection, String> {
    let conn = db::open(db_path).map_err(|e| format!("Could not open database: {e}"))?;
    if !db::quick_check(&conn).map_err(|e| e.to_string())? {
        return Err("Database integrity check failed. Restore a backup to continue.".into());
    }
    Ok(conn)
}

/// Brings the main window forward and asks the UI to open the quick-capture box.
#[cfg(desktop)]
fn open_quick_capture(app: &tauri::AppHandle) {
    use tauri::Emitter;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let _ = app.emit("quick-capture", ());
}

pub const QUICK_CAPTURE_SHORTCUT: &str = "CommandOrControl+Shift+Space";

/// Tray icon (quick note / open / quit) and the system-wide quick-capture shortcut.
#[cfg(desktop)]
fn desktop_extras(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri::Emitter;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    let quick = MenuItem::with_id(app, "quick", "Quick note", true, Some(QUICK_CAPTURE_SHORTCUT))?;
    let open = MenuItem::with_id(app, "open", "Open Noesis", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quick, &open, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main").tooltip("Noesis").menu(&menu).on_menu_event(|app, event| match event.id().as_ref() {
        "quick" => open_quick_capture(app),
        "open" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
        "quit" => {
            // The window finishes pending saves and exits itself; exit anyway if it does not answer.
            let _ = app.emit("quit-requested", ());
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                app.exit(0);
            });
        }
        _ => {}
    });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    open_quick_capture(app);
                }
            })
            .build(),
    )?;
    // Another app may already own the combination; quick capture then stays available from the tray.
    if let Err(e) = app.global_shortcut().register(QUICK_CAPTURE_SHORTCUT) {
        eprintln!("Noesis: quick-capture shortcut unavailable: {e}");
    }
    Ok(())
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
            let attachments_dir = data_dir.join("attachments");
            let db_path = data_dir.join("noesis.db");
            let storage = std::fs::create_dir_all(&data_dir).and_then(|_| std::fs::create_dir_all(&attachments_dir));
            let opened = storage.map_err(|e| e.to_string()).and_then(|_| open_database(&db_path));
            let (conn, startup_error) = match opened {
                Ok(conn) => (Some(conn), None),
                Err(error) => (None, Some(error)),
            };
            app.manage(McpState::default());
            app.manage(AppState { conn: Mutex::new(conn), startup_error: Mutex::new(startup_error), data_dir, db_path, attachments_dir });
            #[cfg(desktop)]
            desktop_extras(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_exec,
            db_integrity,
            secret_get,
            secret_set,
            secret_delete,
            attachment_write,
            attachment_read,
            backup_auto_save,
            attachment_delete,
            export_save,
            fetch_public_url,
            mcp_start,
            mcp_stop,
            mcp_status,
            mcp_respond,
            mcp_clients,
            mcp_connect_client,
            app_info,
            recovery_install,
            recovery_raw,
            recovery_open_backups
        ])
        .run(tauri::generate_context!())
        .expect("error while running Noesis");
}

#[cfg(test)]
mod binary_ipc_tests {
    use super::*;

    #[test]
    fn backup_stamps_sort_by_time() {
        let s = chrono_like_stamp();
        assert_eq!(s.len(), 15);
        assert!(s.starts_with("20"), "{s}");
        assert_eq!(&s[8..9], "-");
    }

    #[test]
    fn binary_messages_round_trip_and_reject_garbage() {
        let msg = pack_binary(&serde_json::json!({ "fileName": "a b.png" }), &[1, 2, 3]);
        let (meta, payload) = split_binary::<AttachmentMeta>(&msg).unwrap();
        assert_eq!(meta.file_name, "a b.png");
        assert_eq!(payload, &[1, 2, 3]);
        assert!(split_binary::<AttachmentMeta>(&[1, 0]).is_err());
        assert!(split_binary::<AttachmentMeta>(&[200, 0, 0, 0, b'{']).is_err(), "length beyond the body");
        assert!(split_binary::<AttachmentMeta>(&[255, 255, 255, 255]).is_err(), "oversized metadata");
        let mut bad = pack_binary(&serde_json::json!({ "other": 1 }), &[]);
        assert!(split_binary::<AttachmentMeta>(&bad).is_err(), "missing field");
        bad.truncate(3);
        assert!(split_binary::<AttachmentMeta>(&bad).is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_database_stays_available_for_recovery_after_repeated_starts() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("noesis.db");
        std::fs::write(&p, b"this is definitely not a sqlite database file, just garbage bytes.......").unwrap();
        let original = std::fs::read(&p).unwrap();
        assert!(open_database(&p).is_err());
        assert!(open_database(&p).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), original);
    }

    #[test]
    fn healthy_database_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("noesis.db");
        {
            let c = open_database(&p).unwrap();
            c.execute_batch("CREATE TABLE keep (x); INSERT INTO keep VALUES (1);").unwrap();
        }
        let c = open_database(&p).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM keep", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }
}
