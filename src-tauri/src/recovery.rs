//! Recovery uses fixed app-owned paths and works without an open database.
use crate::{db, files};
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

pub fn install(conn: &mut Option<Connection>, path: &Path, bytes: &[u8]) -> Result<(), String> {
    if !bytes.starts_with(b"SQLite format 3\0") {
        return Err("Recovery payload is not a SQLite database.".into());
    }
    let id = uuid::Uuid::new_v4();
    let staged = path.with_extension(format!("recovery-{id}.db"));
    files::atomic_write(&staged, bytes)?;
    let validate = || -> Result<(), String> {
        let candidate = Connection::open_with_flags(&staged, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
        if !db::quick_check(&candidate).map_err(|e| e.to_string())? {
            return Err("Restored database failed its integrity check.".into());
        }
        Ok(())
    };
    if let Err(e) = validate() { let _ = std::fs::remove_file(&staged); return Err(e); }
    drop(conn.take());
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut installed = false;
    let result = (|| -> Result<Connection, String> {
        for ext in ["db", "db-wal", "db-shm"] {
            let original = path.with_extension(ext);
            if original.exists() {
                let saved = path.with_extension(format!("pre-recovery-{id}.{ext}"));
                std::fs::rename(&original, &saved).map_err(|e| e.to_string())?;
                moved.push((original, saved));
            }
        }
        std::fs::rename(&staged, path).map_err(|e| e.to_string())?;
        installed = true;
        db::open(path).map_err(|e| e.to_string())
    })();
    match result {
        Ok(c) => { *conn = Some(c); Ok(()) }
        Err(e) => {
            let mut rollback_errors = Vec::new();
            // Keep any candidate sidecars separate from the original WAL/SHM.
            if installed {
                for ext in ["db", "db-wal", "db-shm"] {
                    let file = path.with_extension(ext);
                    if file.exists() {
                        let failed = path.with_extension(format!("failed-recovery-{id}.{ext}"));
                        if let Err(move_error) = std::fs::rename(&file, failed) { rollback_errors.push(move_error.to_string()); }
                    }
                }
            }
            for (original, saved) in moved.iter().rev() {
                if let Err(restore_error) = std::fs::rename(saved, original) { rollback_errors.push(restore_error.to_string()); }
            }
            if rollback_errors.is_empty() { *conn = db::open(path).ok(); }
            let _ = std::fs::remove_file(&staged);
            if rollback_errors.is_empty() { Err(e) } else { Err(format!("{e}; original files remain in pre-recovery copies: {}", rollback_errors.join("; "))) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_without_a_connection_and_preserves_failed_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("noesis.db");
        std::fs::write(&path, b"broken original").unwrap();
        let source = dir.path().join("source.db");
        { let c = Connection::open(&source).unwrap(); c.execute_batch("CREATE TABLE pages(title); INSERT INTO pages VALUES ('Recovered');").unwrap(); }
        let mut conn = None;
        install(&mut conn, &path, &std::fs::read(source).unwrap()).unwrap();
        assert_eq!(conn.unwrap().query_row("SELECT title FROM pages", [], |r| r.get::<_, String>(0)).unwrap(), "Recovered");
        let saved = std::fs::read_dir(dir.path()).unwrap().filter_map(Result::ok).find(|p| p.file_name().to_string_lossy().contains("pre-recovery")).unwrap();
        assert_eq!(std::fs::read(saved.path()).unwrap(), b"broken original");
    }
    #[test]
    fn rejects_invalid_candidates_without_replacing_the_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("noesis.db");
        let mut conn = Some(db::open(&path).unwrap());
        conn.as_ref().unwrap().execute_batch("CREATE TABLE keep(x); INSERT INTO keep VALUES (42)").unwrap();
        assert!(install(&mut conn, &path, b"invalid").is_err());
        let mut corrupt = b"SQLite format 3\0".to_vec(); corrupt.resize(4096, 255);
        assert!(install(&mut conn, &path, &corrupt).is_err());
        assert_eq!(conn.unwrap().query_row("SELECT x FROM keep", [], |r| r.get::<_, i64>(0)).unwrap(), 42);
    }
}
