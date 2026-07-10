use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub preview: String,
    /// Última modificación en milisegundos desde epoch.
    pub updated_at: u64,
    pub pinned: bool,
    /// Etiquetas `#tag` extraídas del contenido, en minúsculas.
    pub tags: Vec<String>,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Identifiers con los que se guardaron datos en versiones anteriores,
/// del más reciente al más antiguo.
const LEGACY_IDENTIFIERS: [&str; 2] = ["com.ale24dev.notely", "com.notely.app"];

/// Migra las notas y ajustes del directorio de datos de un identifier
/// antiguo la primera vez que la app arranca con el actual. Silencioso si
/// no hay nada que migrar (o si el sandbox impide leer fuera del
/// contenedor).
pub fn migrate_legacy_data(app: &AppHandle) {
    let Ok(new_dir) = data_dir(app) else {
        return;
    };
    if new_dir.join("notes").exists() {
        return;
    }
    let Some(parent) = new_dir.parent() else {
        return;
    };
    let Some(old_dir) = LEGACY_IDENTIFIERS
        .iter()
        .map(|id| parent.join(id))
        .find(|dir| dir.join("notes").is_dir())
    else {
        return;
    };
    for name in [
        "notes",
        "attachments",
        "pins.json",
        "tag_colors.json",
        "settings.json",
    ] {
        let from = old_dir.join(name);
        if from.exists() {
            let _ = copy_recursively(&from, &new_dir.join(name));
        }
    }
}

fn copy_recursively(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    if from.is_dir() {
        fs::create_dir_all(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_recursively(&entry.path(), &to.join(entry.file_name()))?;
        }
    } else {
        fs::copy(from, to)?;
    }
    Ok(())
}

/// Directorio donde se guardan las notas como archivos `.md`:
/// `~/Library/Application Support/com.notely.app/notes` en macOS.
fn notes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("notes");
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

// ---- Notas fijadas ----

fn pins_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("pins.json"))
}

fn load_pins(app: &AppHandle) -> HashSet<String> {
    pins_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_pins(app: &AppHandle, pins: &HashSet<String>) -> Result<(), String> {
    let json = serde_json::to_string(pins).map_err(|e| e.to_string())?;
    fs::write(pins_path(app)?, json).map_err(|e| e.to_string())
}

/// Notifica a todas las ventanas (popover y widget) que las notas o sus
/// metadatos cambiaron, para que refresquen su contenido.
fn emit_notes_changed(app: &AppHandle) {
    let _ = app.emit("notes-changed", ());
}

// ---- Adjuntos (imágenes pegadas) ----

pub fn attachments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("attachments");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Resultado de pegar desde el portapapeles: texto tal cual, o una imagen
/// ya guardada como adjunto con su referencia Markdown lista para insertar.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PasteResult {
    Text { text: String },
    Image { markdown: String },
    Empty,
}

#[tauri::command]
pub fn paste_from_clipboard(app: AppHandle) -> Result<PasteResult, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let clipboard = app.clipboard();

    // Primero imagen (una captura de pantalla copiada suele traer también
    // texto irrelevante); si no hay, texto.
    if let Ok(image) = clipboard.read_image() {
        let name = format!("{}.png", uuid::Uuid::new_v4());
        let path = attachments_dir(&app)?.join(&name);
        let file = fs::File::create(&path).map_err(|e| e.to_string())?;
        let mut encoder =
            png::Encoder::new(std::io::BufWriter::new(file), image.width(), image.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(image.rgba())
            .map_err(|e| e.to_string())?;
        return Ok(PasteResult::Image {
            markdown: format!("![imagen](notely://attachments/{name})"),
        });
    }

    if let Ok(text) = clipboard.read_text() {
        return Ok(PasteResult::Text { text });
    }

    Ok(PasteResult::Empty)
}

// ---- Ajustes ----

#[derive(Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub widget_enabled: bool,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    fs::write(settings_path(app)?, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_widget_enabled(app: AppHandle) -> Result<bool, String> {
    Ok(load_settings(&app).widget_enabled)
}

#[tauri::command]
pub fn set_widget_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut settings = load_settings(&app);
    settings.widget_enabled = enabled;
    save_settings(&app, &settings)?;
    crate::apply_widget_visibility(&app, enabled);
    Ok(())
}

// ---- Colores de etiquetas ----

fn tag_colors_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("tag_colors.json"))
}

fn load_tag_colors(app: &AppHandle) -> HashMap<String, String> {
    tag_colors_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Colores elegidos por el usuario, como mapa `tag -> "#rrggbb"`. Las
/// etiquetas sin entrada usan un color por defecto calculado en el frontend.
#[tauri::command]
pub fn get_tag_colors(app: AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(load_tag_colors(&app))
}

#[tauri::command]
pub fn set_tag_color(app: AppHandle, tag: String, color: String) -> Result<(), String> {
    let tag = tag.trim().trim_start_matches('#').to_lowercase();
    if tag.is_empty() {
        return Err("etiqueta vacía".into());
    }
    let hex = color.strip_prefix('#').unwrap_or("");
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("color no válido: se espera #rrggbb".into());
    }
    let mut colors = load_tag_colors(&app);
    colors.insert(tag, color.to_lowercase());
    let json = serde_json::to_string(&colors).map_err(|e| e.to_string())?;
    fs::write(tag_colors_path(&app)?, json).map_err(|e| e.to_string())?;
    emit_notes_changed(&app);
    Ok(())
}

/// Elimina una etiqueta del registro de colores. Si ninguna nota la usa,
/// desaparece de la barra de filtros.
#[tauri::command]
pub fn delete_tag_color(app: AppHandle, tag: String) -> Result<(), String> {
    let tag = tag.trim().trim_start_matches('#').to_lowercase();
    let mut colors = load_tag_colors(&app);
    if colors.remove(&tag).is_some() {
        let json = serde_json::to_string(&colors).map_err(|e| e.to_string())?;
        fs::write(tag_colors_path(&app)?, json).map_err(|e| e.to_string())?;
        emit_notes_changed(&app);
    }
    Ok(())
}

// ---- Metadatos ----

/// Extrae etiquetas `#tag` del contenido, ignorando bloques de código y
/// encabezados Markdown (`# Título` produce un token `#` sin nombre).
fn extract_tags(content: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let mut in_fence = false;
    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        for token in line.split_whitespace() {
            let Some(rest) = token.strip_prefix('#') else {
                continue;
            };
            let tag: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                .collect::<String>()
                .to_lowercase();
            if !tag.is_empty() && !tags.contains(&tag) {
                tags.push(tag);
            }
        }
    }
    tags.sort();
    tags
}

fn meta_from_content(id: &str, content: &str, updated_at: u64, pinned: bool) -> NoteMeta {
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
        pinned,
        tags: extract_tags(content),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---- Comandos ----

#[tauri::command]
pub fn list_notes(app: AppHandle) -> Result<Vec<NoteMeta>, String> {
    let dir = notes_dir(&app)?;
    let pins = load_pins(&app);
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
        notes.push(meta_from_content(id, &content, updated_at, pins.contains(id)));
    }
    // Fijadas primero; dentro de cada grupo, las más recientes arriba.
    notes.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then(b.updated_at.cmp(&a.updated_at))
    });
    Ok(notes)
}

#[tauri::command]
pub fn load_note(app: AppHandle, id: String) -> Result<String, String> {
    fs::read_to_string(note_path(&app, &id)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_note(app: AppHandle, id: String, content: String) -> Result<(), String> {
    fs::write(note_path(&app, &id)?, content).map_err(|e| e.to_string())?;
    emit_notes_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn create_note(app: AppHandle) -> Result<NoteMeta, String> {
    let id = uuid::Uuid::new_v4().to_string();
    fs::write(note_path(&app, &id)?, "").map_err(|e| e.to_string())?;
    emit_notes_changed(&app);
    Ok(meta_from_content(&id, "", now_ms(), false))
}

#[tauri::command]
pub fn delete_note(app: AppHandle, id: String) -> Result<(), String> {
    fs::remove_file(note_path(&app, &id)?).map_err(|e| e.to_string())?;
    let mut pins = load_pins(&app);
    if pins.remove(&id) {
        save_pins(&app, &pins)?;
    }
    emit_notes_changed(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::extract_tags;

    #[test]
    fn extrae_tags_y_omite_encabezados_y_codigo() {
        let md = "# Título\n\
                  Nota con #Trabajo y #casa-2.\n\
                  ```\n\
                  # comentario con #falso-tag\n\
                  ```\n\
                  Repetido: #trabajo";
        assert_eq!(extract_tags(md), vec!["casa-2", "trabajo"]);
    }

    #[test]
    fn sin_tags_devuelve_vacio() {
        assert!(extract_tags("# Solo un título\ny texto normal").is_empty());
    }
}

/// Alterna el estado de fijada de una nota y devuelve el nuevo estado.
#[tauri::command]
pub fn toggle_pin(app: AppHandle, id: String) -> Result<bool, String> {
    // Valida el id y comprueba que la nota existe.
    let path = note_path(&app, &id)?;
    if !path.exists() {
        return Err("la nota no existe".into());
    }
    let mut pins = load_pins(&app);
    let pinned = if pins.remove(&id) {
        false
    } else {
        pins.insert(id);
        true
    };
    save_pins(&app, &pins)?;
    emit_notes_changed(&app);
    Ok(pinned)
}
