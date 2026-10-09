use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::{Path, PathBuf}};
use tauri::Manager;

const MAX_PROJECT_BYTES: u64 = 2_000_000;

#[derive(Default)]
struct ProjectPath(std::sync::Mutex<Option<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedProject {
    contents: String,
    path: String,
}

fn allowed_path(path: &Path) -> Result<(), String> {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("json" | "ocircuit") => Ok(()),
        _ => Err("Use a .json or .ocircuit project file.".into()),
    }
}

#[tauri::command]
fn new_project(state: tauri::State<'_, ProjectPath>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
fn open_project(path: PathBuf) -> Result<OpenedProject, String> {
    allowed_path(&path)?;
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_PROJECT_BYTES { return Err("Project file exceeds 2 MB.".into()); }
    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(OpenedProject { contents, path: path.to_string_lossy().into_owned() })
}

#[tauri::command]
fn save_project(path: PathBuf, contents: String, state: tauri::State<'_, ProjectPath>) -> Result<String, String> {
    allowed_path(&path)?;
    if contents.len() as u64 > MAX_PROJECT_BYTES { return Err("Project file exceeds 2 MB.".into()); }
    let value: serde_json::Value = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    if value.get("version").and_then(|v| v.as_u64()) != Some(2) {
        return Err("Only validated version 2 projects can be saved.".into());
    }
    let parent = path.parent().ok_or("Invalid project path.")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
    temp.persist(&path).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(path.clone());
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_project_as(path: PathBuf, contents: String, state: tauri::State<'_, ProjectPath>) -> Result<String, String> {
    save_project(path, contents, state)
}

#[derive(Serialize, Deserialize, Default)]
struct Preferences { theme: String, language: String }

fn preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map(|p| p.join("preferences.json")).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_preferences(app: tauri::AppHandle) -> Result<Option<Preferences>, String> {
    let path = preferences_path(&app)?;
    if !path.exists() { return Ok(None); }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_preferences(app: tauri::AppHandle, preferences: Preferences) -> Result<(), String> {
    if !matches!(preferences.theme.as_str(), "dark" | "light") || !matches!(preferences.language.as_str(), "th" | "en") {
        return Err("Invalid preferences.".into());
    }
    let path = preferences_path(&app)?;
    let parent = path.parent().ok_or("Invalid preferences path.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(&serde_json::to_vec(&preferences).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn export_netlist(path: PathBuf, netlist: String) -> Result<(), String> {
    if !netlist.is_ascii() || netlist.len() > 65_536 || path.extension().and_then(|e| e.to_str()) != Some("cir") {
        return Err("Invalid .cir netlist export.".into());
    }
    let parent = path.parent().ok_or("Invalid netlist path.")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(netlist.as_bytes()).map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ProjectPath::default())
        .invoke_handler(tauri::generate_handler![new_project, open_project, save_project, save_project_as, load_preferences, save_preferences, export_netlist])
        .run(tauri::generate_context!())
        .expect("error while starting OpenCircuit");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn project_extensions() {
        assert!(allowed_path(Path::new("old.json")).is_ok());
        assert!(allowed_path(Path::new("new.ocircuit")).is_ok());
        assert!(allowed_path(Path::new("unsafe.exe")).is_err());
    }
}
