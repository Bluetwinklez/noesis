//! File-system helpers with strict path validation.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_ATTACHMENT_BYTES: usize = 200 * 1024 * 1024;
/// Saving any document type is fine (attachments can be anything), but never a file
/// Windows would run on double-click: a compromised page must not drop executables.
pub const BLOCKED_EXTENSIONS: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msp", "mst", "dll", "cpl", "sys", "drv", "ocx", "lnk", "url", "reg", "hta", "ps1", "psm1",
    "psd1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "wsc", "jar", "appx", "msix", "application", "gadget", "inf", "scf", "chm", "settingcontent-ms",
];

/// Removes characters Windows forbids in file names and caps the length.
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.');
    let mut out: String = trimmed.chars().take(120).collect();
    if out.is_empty() {
        out = "file".into();
    }
    let stem = out.split('.').next().unwrap_or("").to_ascii_lowercase();
    let reserved = ["con", "prn", "aux", "nul"];
    if reserved.contains(&stem.as_str()) || ((stem.starts_with("com") || stem.starts_with("lpt")) && stem.len() == 4) {
        out = format!("_{out}");
    }
    out
}

/// Accepts only bare storage keys (no separators, no traversal).
pub fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 200
        && !key.contains(['/', '\\', ':'])
        && key != "."
        && !key.contains("..")
        && !key.chars().any(|c| c.is_control())
}

pub fn valid_secret_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 100 && key.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

/// Resolves a storage key inside `dir`, rejecting anything that escapes it.
pub fn resolve_in(dir: &Path, key: &str) -> Result<PathBuf, String> {
    if !valid_key(key) {
        return Err("invalid attachment key".into());
    }
    let p = dir.join(key);
    let canon_dir = dir.canonicalize().map_err(|e| e.to_string())?;
    if let Ok(c) = p.canonicalize() {
        if !c.starts_with(&canon_dir) {
            return Err("path escapes storage directory".into());
        }
    }
    Ok(p)
}

/// Writes via a temp file + rename so a crash never leaves a half-written file.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("path has no parent directory")?;
    let tmp = parent.join(format!(".{}.tmp-{}", path.file_name().and_then(|n| n.to_str()).unwrap_or("f"), uuid::Uuid::new_v4()));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

pub fn validate_user_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err("path must be absolute".into());
    }
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_ascii_lowercase();
    // Windows ignores trailing dots and spaces ("evil.exe." runs as evil.exe).
    let name = name.trim_end_matches(['.', ' ']);
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or_default();
    if BLOCKED_EXTENSIONS.contains(&ext) {
        return Err(format!("saving .{ext} files is not allowed"));
    }
    match p.parent() {
        Some(parent) if parent.is_dir() => Ok(p),
        _ => Err("target folder does not exist".into()),
    }
}

pub fn dir_size(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .map(|it| it.filter_map(Result::ok).filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_file_name("a<b>:c?.md"), "a_b__c_.md");
        assert_eq!(sanitize_file_name("CON.txt"), "_CON.txt");
        assert_eq!(sanitize_file_name("../../x"), "_.._x");
        assert_eq!(sanitize_file_name(""), "file");
    }

    #[test]
    fn rejects_traversal_keys() {
        assert!(!valid_key("../x"));
        assert!(!valid_key("a/b"));
        assert!(!valid_key("a\\b"));
        assert!(!valid_key("C:x"));
        assert!(valid_key("1234-abcd-report.pdf"));
        assert!(valid_secret_key("ai.openai.apiKey"));
        assert!(!valid_secret_key("bad key!"));
    }

    #[test]
    fn export_paths_are_restricted() {
        let dir = tempfile::tempdir().unwrap();
        for ok in ["out.md", "photo.png", "table.xlsx", "README"] {
            assert!(validate_user_path(dir.path().join(ok).to_str().unwrap()).is_ok(), "{ok}");
        }
        for bad in ["evil.exe", "EVIL.BAT", "x.ps1", "trick.exe.", "link.lnk ", "page.hta"] {
            assert!(validate_user_path(dir.path().join(bad).to_str().unwrap()).is_err(), "{bad}");
        }
        assert!(validate_user_path("relative.md").is_err());
        let missing = dir.path().join("nope").join("x.md");
        assert!(validate_user_path(missing.to_str().unwrap()).is_err());
    }

    #[test]
    fn atomic_write_and_resolve() {
        let dir = tempfile::tempdir().unwrap();
        let p = resolve_in(dir.path(), "k-file.txt").unwrap();
        atomic_write(&p, b"hello").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"hello");
        assert!(resolve_in(dir.path(), "..").is_err());
        assert_eq!(dir_size(dir.path()), 5);
    }
}
