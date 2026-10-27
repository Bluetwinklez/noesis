//! Native SQLite access for the frontend repository layer.
//!
//! One connection guarded by a mutex; the TypeScript `Database` class
//! serialises statements so BEGIN/COMMIT pairs are never interleaved.

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Serialize;
use serde_json::{Map, Number, Value as Json};
use std::path::Path;

pub const MAX_SQL_BYTES: usize = 1024 * 1024;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub rows: Vec<Map<String, Json>>,
    pub changes: i64,
    pub last_insert_rowid: i64,
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    Ok(conn)
}

pub fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;",
    )
}

pub fn quick_check(conn: &Connection) -> rusqlite::Result<bool> {
    let r: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    Ok(r == "ok")
}

/// Converts a JSON parameter from the webview into an SQLite value.
pub fn to_value(v: &Json) -> Result<Value, String> {
    Ok(match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(*b as i64),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else {
                Value::Real(n.as_f64().ok_or("invalid number")?)
            }
        }
        Json::String(s) => Value::Text(s.clone()),
        Json::Object(o) => match o.get("blob") {
            Some(Json::Array(bytes)) => Value::Blob(
                bytes
                    .iter()
                    .map(|b| b.as_u64().filter(|x| *x < 256).map(|x| x as u8).ok_or("invalid blob byte"))
                    .collect::<Result<Vec<u8>, _>>()?,
            ),
            _ => return Err("unsupported object parameter".into()),
        },
        Json::Array(_) => return Err("array parameters are not supported".into()),
    })
}

fn from_ref(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::Array(b.iter().map(|x| Json::Number((*x).into())).collect()),
    }
}

/// Executes exactly one statement. Trailing statements are rejected so a
/// single IPC call can never smuggle a second command.
pub fn exec(conn: &Connection, sql: &str, params: &[Json]) -> Result<ExecResult, String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err("empty SQL".into());
    }
    if sql.len() > MAX_SQL_BYTES {
        return Err("SQL statement too large".into());
    }
    let values = params.iter().map(to_value).collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(trimmed).map_err(|e| e.to_string())?;
    // rusqlite's prepare() errors on multiple statements ("Multiple statements provided").
    let col_count = stmt.column_count();
    if col_count > 0 {
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query(params_from_iter(values.iter())).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut m = Map::with_capacity(col_count);
            for (i, name) in names.iter().enumerate() {
                m.insert(name.clone(), from_ref(row.get_ref(i).map_err(|e| e.to_string())?));
            }
            out.push(m);
        }
        Ok(ExecResult { rows: out, changes: 0, last_insert_rowid: 0 })
    } else {
        let changes = stmt.execute(params_from_iter(values.iter())).map_err(|e| e.to_string())?;
        Ok(ExecResult { rows: vec![], changes: changes as i64, last_insert_rowid: conn.last_insert_rowid() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        configure(&c).unwrap();
        c
    }

    #[test]
    fn fts5_is_available() {
        let c = mem();
        exec(&c, "CREATE VIRTUAL TABLE t USING fts5(a, tokenize = 'unicode61 remove_diacritics 2')", &[]).unwrap();
        exec(&c, "INSERT INTO t VALUES (?)", &[json!("Kübitler süperpozisyon")]).unwrap();
        let r = exec(&c, "SELECT snippet(t, 0, '[', ']', '…', 4) AS s FROM t WHERE t MATCH ?", &[json!("kubitler")]).unwrap();
        assert_eq!(r.rows.len(), 1);
        assert!(r.rows[0]["s"].as_str().unwrap().contains('['));
    }

    #[test]
    fn parameters_round_trip() {
        let c = mem();
        exec(&c, "CREATE TABLE x (i INTEGER, r REAL, s TEXT, b BLOB, n)", &[]).unwrap();
        let w = exec(&c, "INSERT INTO x VALUES (?,?,?,?,?)", &[json!(42), json!(1.5), json!("ş"), json!({"blob": [1, 2, 255]}), json!(null)]).unwrap();
        assert_eq!(w.changes, 1);
        assert_eq!(w.last_insert_rowid, 1);
        let r = exec(&c, "SELECT * FROM x", &[]).unwrap();
        let row = &r.rows[0];
        assert_eq!(row["i"], json!(42));
        assert_eq!(row["r"], json!(1.5));
        assert_eq!(row["s"], json!("ş"));
        assert_eq!(row["b"], json!([1, 2, 255]));
        assert_eq!(row["n"], Json::Null);
        assert_eq!(exec(&c, "SELECT ? AS t", &[json!(true)]).unwrap().rows[0]["t"], json!(1));
    }

    #[test]
    fn rejects_bad_input() {
        let c = mem();
        assert!(exec(&c, "   ", &[]).is_err());
        assert!(exec(&c, "SELECT 1; DROP TABLE x", &[]).is_err());
        assert!(exec(&c, "SELECT ?", &[json!([1, 2])]).is_err());
        assert!(exec(&c, "SELECT ?", &[json!({"blob": [300]})]).is_err());
    }

    #[test]
    fn transactions_work_across_calls() {
        let c = mem();
        exec(&c, "CREATE TABLE t (a)", &[]).unwrap();
        exec(&c, "BEGIN IMMEDIATE", &[]).unwrap();
        exec(&c, "INSERT INTO t VALUES (1)", &[]).unwrap();
        exec(&c, "ROLLBACK", &[]).unwrap();
        assert_eq!(exec(&c, "SELECT COUNT(*) c FROM t", &[]).unwrap().rows[0]["c"], json!(0));
    }
}
