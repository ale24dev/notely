use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub preview: String,
    /// Última modificación en milisegundos desde epoch.
    pub updated_at: u64,
}

/// Directorio donde se guardan las notas como archivos `.md`:
/// `~/Library/Application Support/com.notely.app/notes` en macOS.
fn notes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("notes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn note_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    // Los ids son UUIDs generados por la app; cualquier otra cosa se rechaza
    // para que el frontend no pueda escapar del directorio de notas.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("identificador de nota no válido".into());
    }
    Ok(notes_dir(app)?.join(format!("{id}.md")))
}

fn meta_from_content(id: &str, content: &str, updated_at: u64) -> NoteMeta {
    let mut lines = content.lines().filter(|l| !l.trim().is_empty());
    let title = lines
        .next()
        .map(|l| l.trim_start_matches('#').trim().to_string())
        .unwrap_or_default();
    let preview = lines
        .next()
        .map(|l| l.trim().chars().take(80).collect())
        .unwrap_or_default();
    NoteMeta {
        id: id.to_string(),
        title,
        preview,
        updated_at,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn list_notes(app: AppHandle) -> Result<Vec<NoteMeta>, String> {
    let dir = notes_dir(&app)?;
    let mut notes = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let updated_at = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        notes.push(meta_from_content(id, &content, updated_at));
    }
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

#[tauri::command]
pub fn load_note(app: AppHandle, id: String) -> Result<String, String> {
    fs::read_to_string(note_path(&app, &id)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_note(app: AppHandle, id: String, content: String) -> Result<(), String> {
    fs::write(note_path(&app, &id)?, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(app: AppHandle) -> Result<NoteMeta, String> {
    let id = uuid::Uuid::new_v4().to_string();
    fs::write(note_path(&app, &id)?, "").map_err(|e| e.to_string())?;
    Ok(meta_from_content(&id, "", now_ms()))
}

#[tauri::command]
pub fn delete_note(app: AppHandle, id: String) -> Result<(), String> {
    fs::remove_file(note_path(&app, &id)?).map_err(|e| e.to_string())
}
