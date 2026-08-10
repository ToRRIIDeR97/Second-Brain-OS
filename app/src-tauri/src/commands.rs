use crate::db::Database;
use crate::errors::{AppError, AppResult};
use crate::knowledge::parser::ParserRegistry;
use crate::knowledge::search::parse_query;
use crate::platform::{Clock, SystemClock, ensure_application_data_dir};
use crate::terminal::{
    NativePtyAdapter, PresetId, TerminalId, TerminalManager, TerminalSession, TerminalSize,
};
use crate::workspace::git::GitAdapter;
use crate::workspace::language_tools::{
    Diagnostic, FormatResult, LanguageToolService, ToolLanguage, ToolStatus,
};
use crate::workspace::lsp::{LspError, LspManager, LspServerKind, LspSessionId, LspSessionSummary};
use crate::workspace::mutations::{MutationActor, MutationService};
use crate::workspace::{
    ApplicationPolicy, FileKind, PathPolicy, ReadError, RegisterWorkspace, TrustLevel, WorkspaceId,
    WorkspaceKind, WorkspacePath, WorkspaceRegistry, evaluate_policy, list_directory, open_file,
    read_text,
};
use base64::Engine as _;
use ignore::WalkBuilder;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::State;

const IPC_CONTRACT: &str = "ipc_result";
const IPC_VERSION: u32 = 1;
const SHELL_LAYOUT_KEY: &str = "shell.layout";
const WORKSPACES_KEY: &str = "workspace.registry.v1";
const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64_BYTES: usize = MAX_ATTACHMENT_BYTES.div_ceil(3) * 4;

/// Process-local application state. The domain registry deliberately stays
/// independent of Tauri; this adapter is the only place that grants renderer
/// requests access to registered workspace records.
pub struct AppRuntime {
    workspaces: Mutex<WorkspaceRegistry>,
    terminals: Mutex<TerminalManager<NativePtyAdapter>>,
    lsp: Mutex<LspManager>,
}

impl AppRuntime {
    #[must_use]
    pub fn load() -> Self {
        let workspaces = load_workspace_registry().unwrap_or_default();
        Self {
            workspaces: Mutex::new(workspaces),
            terminals: Mutex::new(TerminalManager::new(NativePtyAdapter::new())),
            lsp: Mutex::new(LspManager::new()),
        }
    }
}

impl Default for AppRuntime {
    fn default() -> Self {
        Self::load()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRegistration {
    pub name: String,
    pub root_path: String,
    pub kind: WorkspaceKind,
    pub trust_level: TrustLevel,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    pub kind: WorkspaceKind,
    pub trust_level: TrustLevel,
    pub can_read: bool,
    pub can_write: bool,
    pub can_use_terminal: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererWorkspacePath {
    pub workspace_id: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirectoryEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: FileKind,
    pub size_bytes: u64,
    pub modified_unix_seconds: Option<u64>,
    pub ignored: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirectoryPage {
    pub entries: Vec<WorkspaceDirectoryEntry>,
    pub next_cursor: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadResult {
    pub content: String,
    pub content_hash: String,
    pub revision_id: String,
    pub encoding: &'static str,
    pub eol: &'static str,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAttachmentCreateRequest {
    pub path: RendererWorkspacePath,
    pub bytes_base64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAttachmentCreateResult {
    pub path: RendererWorkspacePath,
    pub media_type: &'static str,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAttachmentReadResult {
    pub base64: String,
    pub media_type: &'static str,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteRequest {
    pub path: RendererWorkspacePath,
    pub content: String,
    pub base_hash: Option<String>,
    pub base_content: Option<String>,
    pub actor: MutationActor,
    pub correlation_id: String,
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteResult {
    pub operation_id: String,
    pub revision_id: String,
    pub content_hash: String,
    pub size_bytes: u64,
    pub merge_notice: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceStatus {
    pub branch: Option<String>,
    pub changes: Vec<GitWorkspaceChange>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceDiff {
    pub staged: bool,
    pub patch: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceChange {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResponse {
    pub results: Vec<WorkspaceSearchResult>,
    pub structured_plan: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    pub id: String,
    pub title: String,
    pub path: String,
    pub snippet: String,
    pub authority: &'static str,
    pub index_state: &'static str,
    pub reason_codes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGraphPage {
    pub nodes: Vec<WorkspaceGraphNode>,
    pub edges: Vec<WorkspaceGraphEdge>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGraphNode {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub authority: &'static str,
    pub confidence: f32,
    pub source: RendererWorkspacePath,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGraphEdge {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    #[serde(rename = "type")]
    pub edge_type: String,
    pub authority: &'static str,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub content: String,
    pub remaining_bytes: usize,
    pub dropped_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum CommandResult<T> {
    Success(CommandSuccess<T>),
    Failure(CommandFailure),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuccess<T> {
    contract: &'static str,
    version: u32,
    ok: bool,
    data: T,
    correlation_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandFailure {
    contract: &'static str,
    version: u32,
    ok: bool,
    error: AppError,
    correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellLayout {
    /// Layout persistence schema. Version 1 payloads are accepted and
    /// normalized to version 2 by `load_layout`/`shell_save_layout`.
    #[serde(default = "default_shell_layout_version")]
    pub version: u32,
    /// The v1 field was named `sidebarWidth`; retain it as a serde alias so
    /// existing installations can be migrated without dropping their width.
    #[serde(alias = "sidebarWidth", default = "default_navigator_width")]
    pub navigator_width: u32,
    #[serde(default = "default_inspector_width")]
    pub inspector_width: u32,
    #[serde(default = "default_navigator_open")]
    pub navigator_open: bool,
    #[serde(default = "default_inspector_open")]
    pub inspector_open: bool,
    #[serde(default)]
    pub drawer_open: bool,
    #[serde(default = "default_drawer_height")]
    pub drawer_height: u32,
    #[serde(default = "default_theme_mode")]
    pub theme_mode: String,
    #[serde(default = "default_inspector_tab")]
    pub inspector_tab: String,
}

const SHELL_LAYOUT_VERSION: u32 = 2;

fn default_shell_layout_version() -> u32 {
    // Payloads that predate an explicit version are treated as v1 so they
    // receive the same migration and safe defaults as existing v1 records.
    1
}

fn default_navigator_width() -> u32 {
    21
}

fn default_navigator_open() -> bool {
    true
}

fn default_inspector_width() -> u32 {
    22
}

fn default_inspector_open() -> bool {
    true
}

fn default_drawer_height() -> u32 {
    // The renderer persists panel dimensions as percentages (the same unit
    // used by react-resizable-panels), so the default mirrors its 30% split.
    30
}

fn default_theme_mode() -> String {
    "light".to_owned()
}

fn default_inspector_tab() -> String {
    "overview".to_owned()
}

impl ShellLayout {
    fn migrated(mut self) -> Self {
        if self.version < SHELL_LAYOUT_VERSION {
            self.version = SHELL_LAYOUT_VERSION;
        }
        self
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCancellation {
    job_id: String,
    cancelled: bool,
}

impl<T> CommandResult<T> {
    fn from_result(result: AppResult<T>, correlation_id: String) -> Self {
        match result {
            Ok(data) => Self::Success(CommandSuccess {
                contract: IPC_CONTRACT,
                version: IPC_VERSION,
                ok: true,
                data,
                correlation_id,
            }),
            Err(error) => Self::Failure(CommandFailure {
                contract: IPC_CONTRACT,
                version: IPC_VERSION,
                ok: false,
                error: error.redacted(),
                correlation_id,
            }),
        }
    }
}

fn correlation_id() -> String {
    format!("corr_{}", ulid::Ulid::new())
}

fn database() -> AppResult<Database> {
    Database::open(ensure_application_data_dir()?.database)
}

fn load_layout(database: &Database) -> AppResult<Option<ShellLayout>> {
    let value = database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                [SHELL_LAYOUT_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()
    })?;
    value
        .map(|value| {
            serde_json::from_str(&value).map_err(|error| {
                AppError::new(
                    "settings.invalid",
                    "The saved shell layout could not be read.",
                )
                .with_details(serde_json::Value::String(error.to_string()))
            })
        })
        .map(|layout| layout.map(ShellLayout::migrated))
        .transpose()
}

fn save_layout(database: &Database, layout: &ShellLayout) -> AppResult<()> {
    let layout = layout.clone().migrated();
    let value = serde_json::to_string(&layout).map_err(|error| {
        AppError::new("settings.serialize", "The shell layout could not be saved.")
            .with_details(serde_json::Value::String(error.to_string()))
    })?;
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO app_settings (key, value_json, schema_version, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               schema_version = excluded.schema_version,
               updated_at = excluded.updated_at",
            params![
                SHELL_LAYOUT_KEY,
                value,
                layout.version,
                SystemClock.now_utc()
            ],
        )?;
        Ok(())
    })
}

fn load_workspace_registry() -> AppResult<WorkspaceRegistry> {
    let database = database()?;
    let stored = database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                [WORKSPACES_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()
    })?;
    let Some(stored) = stored else {
        return Ok(WorkspaceRegistry::new());
    };
    let records: Vec<crate::workspace::WorkspaceRecord> =
        serde_json::from_str(&stored).map_err(|error| {
            AppError::new(
                "workspace.registry_invalid",
                "The saved workspace registry could not be read.",
            )
            .with_details(serde_json::json!({ "reason": error.to_string() }))
        })?;
    let mut registry = WorkspaceRegistry::new();
    for record in records.into_iter().filter(|record| !record.deleted) {
        let result = registry.register(RegisterWorkspace {
            id: Some(record.id),
            name: record.name,
            kind: record.kind,
            display_root: record.display_root.map(Into::into),
            trust_level: Some(record.trust_level),
        });
        if result.is_err() {
            continue;
        }
    }
    Ok(registry)
}

fn persist_workspace_registry(registry: &WorkspaceRegistry) -> AppResult<()> {
    let records = registry.records().cloned().collect::<Vec<_>>();
    let value = serde_json::to_string(&records).map_err(|error| {
        AppError::new(
            "workspace.registry_serialize",
            "The workspace registry could not be saved.",
        )
        .with_details(serde_json::json!({ "reason": error.to_string() }))
    })?;
    database()?.with_connection(|connection| {
        connection.execute(
            "INSERT INTO app_settings (key, value_json, schema_version, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               schema_version = excluded.schema_version,
               updated_at = excluded.updated_at",
            params![WORKSPACES_KEY, value, 1, SystemClock.now_utc()],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn system_ping() -> CommandResult<&'static str> {
    CommandResult::from_result(Ok("pong"), correlation_id())
}

#[tauri::command]
pub fn system_sample_error() -> CommandResult<()> {
    CommandResult::from_result(
        Err(AppError::new(
            "system.sample_error",
            "This typed sample error is working as expected.",
        )),
        correlation_id(),
    )
}

#[tauri::command]
pub fn shell_load_layout() -> CommandResult<Option<ShellLayout>> {
    let result = database().and_then(|database| load_layout(&database));
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn shell_save_layout(layout: ShellLayout) -> CommandResult<ShellLayout> {
    let layout = layout.migrated();
    let result = database().and_then(|database| {
        save_layout(&database, &layout)?;
        Ok(layout)
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn job_cancel(job_id: String) -> CommandResult<JobCancellation> {
    CommandResult::from_result(
        Ok(JobCancellation {
            job_id,
            cancelled: false,
        }),
        correlation_id(),
    )
}

fn runtime_workspaces(runtime: &AppRuntime) -> AppResult<MutexGuard<'_, WorkspaceRegistry>> {
    runtime.workspaces.lock().map_err(|_| {
        AppError::new(
            "runtime.unavailable",
            "The workspace service is temporarily unavailable. Please try again.",
        )
        .retryable(true)
    })
}

fn runtime_terminals(
    runtime: &AppRuntime,
) -> AppResult<MutexGuard<'_, TerminalManager<NativePtyAdapter>>> {
    runtime.terminals.lock().map_err(|_| {
        AppError::new(
            "runtime.unavailable",
            "The terminal service is temporarily unavailable. Please try again.",
        )
        .retryable(true)
    })
}

fn workspace_summary(record: &crate::workspace::WorkspaceRecord) -> WorkspaceSummary {
    let capabilities = record.trust_level.capabilities();
    WorkspaceSummary {
        id: record.id.as_str().to_owned(),
        name: record.name.clone(),
        root_path: record.display_root.clone(),
        kind: record.kind,
        trust_level: record.trust_level,
        can_read: capabilities.read,
        can_write: capabilities.write,
        can_use_terminal: capabilities.terminal,
    }
}

fn app_error(code: &str, error: impl std::fmt::Display) -> AppError {
    AppError::new(code, error.to_string())
}

fn attachment_too_large() -> AppError {
    AppError::new(
        "file.attachment_too_large",
        "The image exceeds the 10 MiB attachment limit.",
    )
}

fn attachment_not_image() -> AppError {
    AppError::new(
        "file.attachment_not_image",
        "The attachment is not a supported image.",
    )
}

fn attachment_media_type(bytes: &[u8]) -> Option<&'static str> {
    if is_png(bytes) {
        Some("image/png")
    } else if is_jpeg(bytes) {
        Some("image/jpeg")
    } else if is_gif(bytes) {
        Some("image/gif")
    } else if is_webp(bytes) {
        Some("image/webp")
    } else {
        None
    }
}

fn validate_attachment_bytes(bytes: &[u8]) -> AppResult<&'static str> {
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(attachment_too_large());
    }
    attachment_media_type(bytes).ok_or_else(attachment_not_image)
}

fn decode_attachment(bytes_base64: &str) -> AppResult<Vec<u8>> {
    if bytes_base64.len() > MAX_ATTACHMENT_BASE64_BYTES {
        return Err(attachment_too_large());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64.as_bytes())
        .map_err(|_| {
            AppError::new(
                "file.attachment_invalid_base64",
                "The attachment data is not valid base64.",
            )
        })?;
    validate_attachment_bytes(&bytes)?;
    Ok(bytes)
}

fn is_png(bytes: &[u8]) -> bool {
    const SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 33 || !bytes.starts_with(SIGNATURE) {
        return false;
    }
    let mut offset = 8usize;
    let mut first_chunk = true;
    let mut saw_header = false;
    while offset + 12 <= bytes.len() {
        let length = u32::from_be_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ]) as usize;
        let Some(end) = offset
            .checked_add(12)
            .and_then(|value| value.checked_add(length))
        else {
            return false;
        };
        if end > bytes.len() {
            return false;
        }
        let kind = &bytes[offset + 4..offset + 8];
        let data = &bytes[offset + 8..offset + 8 + length];
        if first_chunk && (kind != b"IHDR" || length != 13) {
            return false;
        }
        first_chunk = false;
        if kind == b"IHDR" {
            if length != 13 {
                return false;
            }
            let width = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
            let height = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
            if width == 0 || height == 0 {
                return false;
            }
            saw_header = true;
        }
        if kind == b"IEND" {
            return length == 0 && saw_header && end == bytes.len();
        }
        offset = end;
    }
    false
}

fn is_jpeg(bytes: &[u8]) -> bool {
    if bytes.len() < 4 || bytes[0..2] != [0xff, 0xd8] {
        return false;
    }
    let mut offset = 2usize;
    let mut saw_frame = false;
    while offset < bytes.len() {
        if bytes[offset] != 0xff {
            return false;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        if offset >= bytes.len() {
            return false;
        }
        let marker = bytes[offset];
        offset += 1;
        if marker == 0xd9 {
            return saw_frame && offset == bytes.len();
        }
        if marker == 0xd8 || marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        if offset + 2 > bytes.len() {
            return false;
        }
        let segment_length = u16::from_be_bytes([bytes[offset], bytes[offset + 1]]) as usize;
        if segment_length < 2 {
            return false;
        }
        let Some(segment_end) = offset.checked_add(segment_length) else {
            return false;
        };
        if segment_end > bytes.len() {
            return false;
        }
        let segment = &bytes[offset + 2..segment_end];
        if is_jpeg_frame_marker(marker) {
            if segment.len() < 6 {
                return false;
            }
            let height = u16::from_be_bytes([segment[1], segment[2]]);
            let width = u16::from_be_bytes([segment[3], segment[4]]);
            if width == 0 || height == 0 {
                return false;
            }
            saw_frame = true;
        }
        offset = segment_end;
        if marker == 0xda {
            // After SOS, marker bytes are escaped as FF 00 or restart markers.
            // Scan data ends at an unescaped EOI; no image payload is retained.
            while offset + 1 < bytes.len() {
                if bytes[offset] != 0xff {
                    offset += 1;
                    continue;
                }
                let next = bytes[offset + 1];
                if next == 0x00 || (0xd0..=0xd7).contains(&next) {
                    offset += 2;
                } else if next == 0xff {
                    offset += 1;
                } else if next == 0xd9 {
                    return saw_frame && offset + 2 == bytes.len();
                } else {
                    return false;
                }
            }
            return false;
        }
    }
    false
}

fn is_jpeg_frame_marker(marker: u8) -> bool {
    matches!(
        marker,
        0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf
    )
}

fn is_gif(bytes: &[u8]) -> bool {
    if bytes.len() < 14 || !(bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return false;
    }
    let width = u16::from_le_bytes([bytes[6], bytes[7]]);
    let height = u16::from_le_bytes([bytes[8], bytes[9]]);
    if width == 0 || height == 0 {
        return false;
    }
    let mut offset = 13usize;
    let packed = bytes[10];
    if packed & 0x80 != 0 {
        let entries = 1usize << ((packed & 0x07) + 1);
        let Some(end) = offset.checked_add(entries * 3) else {
            return false;
        };
        if end > bytes.len() {
            return false;
        }
        offset = end;
    }
    let mut saw_image = false;
    while offset < bytes.len() {
        match bytes[offset] {
            0x3b => return saw_image && offset + 1 == bytes.len(),
            0x21 => {
                if offset + 2 > bytes.len() {
                    return false;
                }
                offset += 2;
                if !skip_gif_sub_blocks(bytes, &mut offset) {
                    return false;
                }
            }
            0x2c => {
                if offset + 10 > bytes.len() {
                    return false;
                }
                let image_width = u16::from_le_bytes([bytes[offset + 5], bytes[offset + 6]]);
                let image_height = u16::from_le_bytes([bytes[offset + 7], bytes[offset + 8]]);
                if image_width == 0 || image_height == 0 {
                    return false;
                }
                let image_packed = bytes[offset + 9];
                offset += 10;
                if image_packed & 0x80 != 0 {
                    let entries = 1usize << ((image_packed & 0x07) + 1);
                    let Some(end) = offset.checked_add(entries * 3) else {
                        return false;
                    };
                    if end > bytes.len() {
                        return false;
                    }
                    offset = end;
                }
                if offset >= bytes.len() {
                    return false;
                }
                offset += 1; // LZW minimum code size.
                if !skip_gif_sub_blocks(bytes, &mut offset) {
                    return false;
                }
                saw_image = true;
            }
            _ => return false,
        }
    }
    false
}

fn skip_gif_sub_blocks(bytes: &[u8], offset: &mut usize) -> bool {
    loop {
        if *offset >= bytes.len() {
            return false;
        }
        let length = bytes[*offset] as usize;
        *offset += 1;
        if length == 0 {
            return true;
        }
        let Some(end) = (*offset).checked_add(length) else {
            return false;
        };
        if end > bytes.len() {
            return false;
        }
        *offset = end;
    }
}

fn is_webp(bytes: &[u8]) -> bool {
    if bytes.len() < 20 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return false;
    }
    let declared_size = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    let Some(container_end) = declared_size.checked_add(8) else {
        return false;
    };
    if container_end != bytes.len() || container_end < 20 {
        return false;
    }
    let mut offset = 12usize;
    let mut saw_frame = false;
    while offset < container_end {
        if offset + 8 > container_end {
            return false;
        }
        let kind = &bytes[offset..offset + 4];
        let length = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let Some(data_start) = offset.checked_add(8) else {
            return false;
        };
        let Some(data_end) = data_start.checked_add(length) else {
            return false;
        };
        let padded_end = data_end + (length & 1);
        if padded_end > container_end {
            return false;
        }
        let data = &bytes[data_start..data_end];
        match kind {
            b"VP8 " => {
                if data.len() < 10
                    || data[3..6] != [0x9d, 0x01, 0x2a]
                    || u16::from_le_bytes([data[6], data[7]]) & 0x3fff == 0
                    || u16::from_le_bytes([data[8], data[9]]) & 0x3fff == 0
                {
                    return false;
                }
                saw_frame = true;
            }
            b"VP8L" => {
                if data.len() < 5 || data[0] != 0x2f {
                    return false;
                }
                let width = 1 + (((data[1] as usize) | ((data[2] as usize & 0x3f) << 8)) & 0x3ff);
                let height = 1
                    + (((data[2] as usize >> 6)
                        | ((data[3] as usize) << 2)
                        | ((data[4] as usize & 0x0f) << 10))
                        & 0x3ff);
                if width == 0 || height == 0 {
                    return false;
                }
                saw_frame = true;
            }
            b"VP8X" => {
                if data.len() < 10 {
                    return false;
                }
                let width =
                    1 + (data[4] as usize | ((data[5] as usize) << 8) | ((data[6] as usize) << 16));
                let height =
                    1 + (data[7] as usize | ((data[8] as usize) << 8) | ((data[9] as usize) << 16));
                if width == 0 || height == 0 {
                    return false;
                }
                saw_frame = true;
            }
            _ => {}
        }
        offset = padded_end;
    }
    saw_frame && offset == container_end
}

fn registered_workspace(
    runtime: &AppRuntime,
    workspace_id: &str,
) -> AppResult<crate::workspace::WorkspaceRecord> {
    let registry = runtime_workspaces(runtime)?;
    let record = registry
        .open(&WorkspaceId::from(workspace_id))
        .map_err(|error| app_error("workspace.unavailable", error))?
        .clone();
    Ok(record)
}

fn workspace_path(path: &RendererWorkspacePath) -> AppResult<WorkspacePath> {
    WorkspacePath::new(
        WorkspaceId::from(path.workspace_id.as_str()),
        &path.relative_path,
    )
    .map_err(|error| app_error("workspace.invalid_path", error))
}

fn text_eol(content: &str) -> &'static str {
    let has_lf = content.contains('\n');
    let has_crlf = content.contains("\r\n");
    match (has_lf, has_crlf) {
        (false, _) => "lf",
        (true, true) if content.replace("\r\n", "").contains('\n') => "mixed",
        (true, true) => "crlf",
        (true, false) => "lf",
    }
}

fn git_change_status(change: &crate::workspace::git::GitChange) -> String {
    format!("{:?}", change.kind).to_lowercase()
}

#[tauri::command]
pub fn workspace_register(
    registration: WorkspaceRegistration,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<WorkspaceSummary> {
    let result = (|| {
        let display_root =
            (registration.kind != WorkspaceKind::Collection).then(|| registration.root_path.into());
        let mut registry = runtime_workspaces(&runtime)?;
        let record = registry
            .register(RegisterWorkspace {
                id: None,
                name: registration.name,
                kind: registration.kind,
                display_root,
                trust_level: Some(registration.trust_level),
            })
            .map_err(|error| app_error("workspace.register_failed", error))?;
        persist_workspace_registry(&registry)?;
        Ok(workspace_summary(&record))
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn workspace_list(runtime: State<'_, AppRuntime>) -> CommandResult<Vec<WorkspaceSummary>> {
    let result = (|| {
        let registry = runtime_workspaces(&runtime)?;
        Ok(registry.records().map(workspace_summary).collect())
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn workspace_list_directory(
    path: RendererWorkspacePath,
    cursor: Option<usize>,
    limit: Option<usize>,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<WorkspaceDirectoryPage> {
    let result = (|| {
        let record = registered_workspace(&runtime, &path.workspace_id)?;
        if !record.trust_level.capabilities().read {
            return Err(AppError::new(
                "workspace.read_denied",
                "This workspace is not readable.",
            ));
        }
        let path = workspace_path(&path)?;
        let validated = PathPolicy::default()
            .validate(&record, &path)
            .map_err(|error| app_error("workspace.path_denied", error))?;
        let page = list_directory(&validated, cursor.unwrap_or(0), limit.unwrap_or(200), None)
            .map_err(|error| app_error("workspace.directory_failed", error))?;
        Ok(WorkspaceDirectoryPage {
            entries: page
                .entries
                .into_iter()
                .map(|entry| WorkspaceDirectoryEntry {
                    name: entry.name,
                    relative_path: entry.relative_path,
                    kind: entry.kind,
                    size_bytes: entry.size_bytes,
                    modified_unix_seconds: entry.modified_unix_seconds,
                    ignored: entry.ignored,
                })
                .collect(),
            next_cursor: page.next_cursor,
        })
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn file_read_text(
    path: RendererWorkspacePath,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<FileReadResult> {
    let result = (|| {
        let record = registered_workspace(&runtime, &path.workspace_id)?;
        if !record.trust_level.capabilities().read {
            return Err(AppError::new(
                "workspace.read_denied",
                "This workspace is not readable.",
            ));
        }
        let path = workspace_path(&path)?;
        let read = read_text(&PathPolicy::default(), &record, &path, None)
            .map_err(|error| app_error("file.read_failed", error))?;
        let content_hash = blake3::hash(read.content.as_bytes()).to_hex().to_string();
        let revision_id = format!("rev_{content_hash}");
        let eol = text_eol(&read.content);
        Ok(FileReadResult {
            content: read.content,
            content_hash,
            revision_id,
            encoding: "utf8",
            eol,
            size_bytes: read.size_bytes,
        })
    })();
    CommandResult::from_result(result, correlation_id())
}

fn attachment_create_error(error: crate::workspace::mutations::MutationError) -> AppError {
    use crate::workspace::mutations::MutationError;

    match error {
        MutationError::AlreadyExists => AppError::new(
            "file.attachment_exists",
            "An attachment already exists at that path.",
        ),
        MutationError::WorkspaceMismatch
        | MutationError::InvalidPath(_)
        | MutationError::PathEscape => AppError::new(
            "file.attachment_path_denied",
            "The attachment path is not allowed in this workspace.",
        ),
        _ => AppError::new(
            "file.attachment_create_failed",
            "The image could not be saved.",
        ),
    }
}

fn attachment_read_error(error: ReadError) -> AppError {
    match error {
        ReadError::Path(error) => app_error("workspace.path_denied", error),
        ReadError::NotFile => AppError::new(
            "file.attachment_not_file",
            "The attachment path is not a file.",
        ),
        ReadError::TooLarge { .. } => attachment_too_large(),
        _ => AppError::new(
            "file.attachment_read_failed",
            "The image could not be read.",
        ),
    }
}

#[tauri::command]
pub fn file_create_attachment(
    request: FileAttachmentCreateRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<FileAttachmentCreateResult> {
    let result = (|| {
        let record = registered_workspace(&runtime, &request.path.workspace_id)?;
        if !record.trust_level.capabilities().write {
            return Err(AppError::new(
                "workspace.write_denied",
                "This workspace is read-only. Set it to Trusted before adding attachments.",
            ));
        }
        let path = workspace_path(&request.path)?;
        PathPolicy::default()
            .validate_nearest_existing_parent(&record, &path)
            .map_err(|error| app_error("workspace.path_denied", error))?;
        let bytes = decode_attachment(&request.bytes_base64)?;
        let media_type = attachment_media_type(&bytes).ok_or_else(attachment_not_image)?;
        let root = record.root_path().ok_or_else(|| {
            AppError::new(
                "workspace.no_root",
                "This workspace has no filesystem root.",
            )
        })?;
        let service = MutationService::new(record.id.as_str(), root)
            .map_err(|error| app_error("file.attachment_unavailable", error))?;
        let mutation_path = crate::workspace::mutations::WorkspacePath::new(
            request.path.workspace_id.clone(),
            request.path.relative_path.clone(),
        );
        service
            .create_attachment(
                &mutation_path,
                &bytes,
                MutationActor::user("renderer"),
                correlation_id(),
            )
            .map_err(attachment_create_error)?;
        Ok(FileAttachmentCreateResult {
            path: request.path,
            media_type,
            size_bytes: bytes.len() as u64,
        })
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn file_read_attachment(
    path: RendererWorkspacePath,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<FileAttachmentReadResult> {
    let result = (|| {
        let record = registered_workspace(&runtime, &path.workspace_id)?;
        if !record.trust_level.capabilities().read {
            return Err(AppError::new(
                "workspace.read_denied",
                "This workspace is not readable.",
            ));
        }
        let path = workspace_path(&path)?;
        let mut descriptor =
            open_file(&PathPolicy::default(), &record, &path).map_err(attachment_read_error)?;
        if descriptor.size_bytes > MAX_ATTACHMENT_BYTES as u64 {
            return Err(attachment_too_large());
        }
        let expected_size =
            usize::try_from(descriptor.size_bytes).map_err(|_| attachment_too_large())?;
        let mut bytes = Vec::with_capacity(expected_size);
        let mut offset = 0_u64;
        while offset < descriptor.size_bytes {
            let remaining = descriptor.size_bytes - offset;
            let limit = remaining.min(64 * 1024) as usize;
            let chunk = descriptor
                .read_chunk(offset, limit)
                .map_err(attachment_read_error)?;
            if chunk.is_empty() {
                return Err(AppError::new(
                    "file.attachment_read_failed",
                    "The image could not be read.",
                ));
            }
            offset += chunk.len() as u64;
            bytes.extend_from_slice(&chunk);
        }
        let media_type = validate_attachment_bytes(&bytes)?;
        Ok(FileAttachmentReadResult {
            base64: base64::engine::general_purpose::STANDARD.encode(bytes.as_slice()),
            media_type,
            size_bytes: bytes.len() as u64,
        })
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn file_write_text(
    request: FileWriteRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<FileWriteResult> {
    let result = (|| {
        let record = registered_workspace(&runtime, &request.path.workspace_id)?;
        if !record.trust_level.capabilities().write {
            return Err(AppError::new(
                "workspace.write_denied",
                "This workspace is read-only. Set it to Trusted before editing files.",
            ));
        }
        let root = record.root_path().ok_or_else(|| {
            AppError::new(
                "workspace.no_root",
                "This workspace has no filesystem root.",
            )
        })?;
        let service = MutationService::new(record.id.as_str(), root)
            .map_err(|error| app_error("file.write_unavailable", error))?;
        let mutation_path = crate::workspace::mutations::WorkspacePath::new(
            request.path.workspace_id,
            request.path.relative_path,
        );
        let mutation = service
            .write_text(
                &mutation_path,
                crate::workspace::mutations::WriteTextRequest {
                    content: request.content,
                    base_hash: request.base_hash,
                    base_content: request.base_content,
                    actor: request.actor,
                    correlation_id: request.correlation_id,
                    operation_id: request.operation_id,
                },
            )
            .map_err(|error| app_error("file.write_failed", error))?;
        let content_hash = mutation.content_hash.ok_or_else(|| {
            AppError::new(
                "file.write_failed",
                "The save completed without a text content hash.",
            )
        })?;
        Ok(FileWriteResult {
            operation_id: mutation.operation_id,
            revision_id: mutation.revision_id,
            content_hash,
            size_bytes: mutation.size_bytes,
            merge_notice: mutation.merge_notice,
        })
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn git_status(
    workspace_id: String,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<GitWorkspaceStatus> {
    let result = (|| {
        let record = registered_workspace(&runtime, &workspace_id)?;
        let root = record.root_path().ok_or_else(|| {
            AppError::new(
                "workspace.no_root",
                "This workspace has no filesystem root.",
            )
        })?;
        let status = GitAdapter::new(root)
            .status()
            .map_err(|error| app_error("git.status_failed", error))?;
        Ok(GitWorkspaceStatus {
            branch: status.branch,
            changes: status
                .changes
                .iter()
                .map(|change| GitWorkspaceChange {
                    path: change.path.clone(),
                    status: git_change_status(change),
                    staged: change.staged,
                })
                .collect(),
        })
    })();
    CommandResult::from_result(result, correlation_id())
}

/// Return a read-only patch for validated paths in a registered workspace.
///
/// `GitAdapter::diff` performs the final relative-path validation and always
/// places the path separator before renderer-provided paths. Workspace
/// resolution happens first so an arbitrary filesystem root cannot be passed
/// through this IPC seam.
#[tauri::command]
pub fn git_diff(
    workspace_id: String,
    staged: bool,
    paths: Vec<String>,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<GitWorkspaceDiff> {
    let result = (|| {
        let record = registered_workspace(&runtime, &workspace_id)?;
        if !record.trust_level.capabilities().read {
            return Err(AppError::new(
                "workspace.read_denied",
                "This workspace is not readable.",
            ));
        }
        let root = record.root_path().ok_or_else(|| {
            AppError::new(
                "workspace.no_root",
                "This workspace has no filesystem root.",
            )
        })?;
        let diff = GitAdapter::new(root)
            .diff(staged, &paths)
            .map_err(|error| app_error("git.diff_failed", error))?;
        Ok(GitWorkspaceDiff {
            staged: diff.staged,
            patch: diff.patch,
            truncated: diff.truncated,
        })
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn git_file_diff(
    workspace_id: String,
    staged: bool,
    path: String,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<crate::workspace::git::GitFileDiff> {
    let result = (|| {
        let record = registered_workspace(&runtime, &workspace_id)?;
        if !record.trust_level.capabilities().read {
            return Err(AppError::new(
                "workspace.read_denied",
                "This workspace is not readable.",
            ));
        }
        let root = record.root_path().ok_or_else(|| {
            AppError::new(
                "workspace.no_root",
                "This workspace has no filesystem root.",
            )
        })?;
        GitAdapter::new(root)
            .diff_file(staged, &path)
            .map_err(|error| app_error("git.diff_failed", error))
    })();
    CommandResult::from_result(result, correlation_id())
}

fn language_tool_service(
    runtime: &AppRuntime,
    workspace_id: &str,
) -> AppResult<LanguageToolService> {
    let record = registered_workspace(runtime, workspace_id)?;
    if !record.trust_level.capabilities().terminal {
        return Err(AppError::new(
            "language_tools.trust_required",
            "Language tools require a trusted workspace.",
        ));
    }
    let root = record.root_path().ok_or_else(|| {
        AppError::new(
            "workspace.no_root",
            "This workspace has no filesystem root.",
        )
    })?;
    Ok(LanguageToolService::new(root))
}

#[tauri::command]
pub fn language_tools_status(
    workspace_id: String,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<Vec<ToolStatus>> {
    let result = language_tool_service(&runtime, &workspace_id).and_then(|service| {
        service
            .statuses()
            .map_err(|error| app_error("language_tools.status_failed", error))
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn language_format(
    workspace_id: String,
    relative_path: String,
    language: ToolLanguage,
    content: String,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<FormatResult> {
    let result = language_tool_service(&runtime, &workspace_id).and_then(|service| {
        service
            .format(language, &relative_path, &content)
            .map_err(|error| app_error("language_tools.format_failed", error))
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn language_analyze(
    workspace_id: String,
    language: Option<ToolLanguage>,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<Vec<Diagnostic>> {
    let result = language_tool_service(&runtime, &workspace_id).and_then(|service| {
        service
            .analyze(language)
            .map_err(|error| app_error("language_tools.analyze_failed", error))
    });
    CommandResult::from_result(result, correlation_id())
}

fn runtime_lsp(runtime: &AppRuntime) -> AppResult<MutexGuard<'_, LspManager>> {
    runtime.lsp.lock().map_err(|_| {
        AppError::new(
            "lsp.runtime_unavailable",
            "The language-server runtime is unavailable.",
        )
    })
}

#[tauri::command]
pub fn lsp_start(
    workspace_id: String,
    server: LspServerKind,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<LspSessionSummary> {
    let result = (|| {
        let workspace = registered_workspace(&runtime, &workspace_id)?;
        runtime_lsp(&runtime)?
            .start(&workspace, server)
            .map_err(|error| app_error("lsp.start_failed", error))
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn lsp_send(
    workspace_id: String,
    session_id: String,
    message: serde_json::Value,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let result = runtime_lsp(&runtime).and_then(|manager| {
        manager
            .send(
                &WorkspaceId::from(workspace_id.as_str()),
                &LspSessionId::from(session_id.as_str()),
                &message,
            )
            .map_err(|error| app_error("lsp.send_failed", error))
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn lsp_receive(
    workspace_id: String,
    session_id: String,
    timeout_ms: Option<u64>,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<Option<serde_json::Value>> {
    let result = runtime_lsp(&runtime).and_then(|manager| {
        match manager.receive(
            &WorkspaceId::from(workspace_id.as_str()),
            &LspSessionId::from(session_id.as_str()),
            Duration::from_millis(timeout_ms.unwrap_or(100).min(250)),
        ) {
            Ok(message) => Ok(Some(message)),
            Err(LspError::ReceiveTimeout) => Ok(None),
            Err(error) => Err(app_error("lsp.receive_failed", error)),
        }
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn lsp_stop(
    workspace_id: String,
    session_id: String,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<LspSessionSummary> {
    let result = runtime_lsp(&runtime).and_then(|mut manager| {
        manager
            .stop(
                &WorkspaceId::from(workspace_id.as_str()),
                &LspSessionId::from(session_id.as_str()),
            )
            .map_err(|error| app_error("lsp.stop_failed", error))
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn git_stage(
    workspace_id: String,
    paths: Vec<String>,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let result = git_mutation(&runtime, &workspace_id, &paths, |git, values| {
        git.stage(values)
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn git_unstage(
    workspace_id: String,
    paths: Vec<String>,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let result = git_mutation(&runtime, &workspace_id, &paths, |git, values| {
        git.unstage(values)
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn git_discard(
    workspace_id: String,
    paths: Vec<String>,
    confirmed: bool,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let result = (|| {
        let record = registered_workspace(&runtime, &workspace_id)?;
        let root = record.root_path().ok_or_else(|| {
            AppError::new(
                "workspace.no_root",
                "This workspace has no filesystem root.",
            )
        })?;
        GitAdapter::new(root)
            .discard(&paths, confirmed)
            .map_err(|error| app_error("git.discard_failed", error))?;
        Ok(())
    })();
    CommandResult::from_result(result, correlation_id())
}

fn git_mutation(
    runtime: &AppRuntime,
    workspace_id: &str,
    paths: &[String],
    operation: impl FnOnce(
        &GitAdapter,
        &[String],
    ) -> Result<
        crate::workspace::git::GitOperationResult,
        crate::workspace::git::GitError,
    >,
) -> AppResult<()> {
    let record = registered_workspace(runtime, workspace_id)?;
    let root = record.root_path().ok_or_else(|| {
        AppError::new(
            "workspace.no_root",
            "This workspace has no filesystem root.",
        )
    })?;
    operation(&GitAdapter::new(root), paths)
        .map_err(|error| app_error("git.operation_failed", error))?;
    Ok(())
}

fn workspace_text_files(
    record: &crate::workspace::WorkspaceRecord,
) -> AppResult<Vec<(String, String)>> {
    let root = record.root_path().ok_or_else(|| {
        AppError::new(
            "workspace.no_root",
            "This workspace has no filesystem root.",
        )
    })?;
    let mut files = Vec::new();
    for entry in WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .build()
    {
        let entry = entry.map_err(|error| app_error("workspace.walk_failed", error))?;
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| app_error("workspace.walk_failed", error))?
            .to_string_lossy()
            .replace('\\', "/");
        if is_sensitive_search_path(&relative) {
            continue;
        }
        let path = WorkspacePath::new(record.id.clone(), &relative)
            .map_err(|error| app_error("workspace.invalid_path", error))?;
        let text = match read_text(&PathPolicy::default(), record, &path, Some(512 * 1024)) {
            Ok(text) if !text.truncated => text.content,
            Ok(_) | Err(_) => continue,
        };
        files.push((relative, text));
        if files.len() >= 1_000 {
            break;
        }
    }
    Ok(files)
}

fn is_sensitive_search_path(relative: &str) -> bool {
    Path::new(relative).components().any(|component| {
        let component = component.as_os_str().to_string_lossy();
        component == ".git"
            || component == "credentials"
            || component == ".env"
            || component.starts_with(".env.")
    })
}

fn search_snippet(content: &str, terms: &[String]) -> String {
    let lowered = content.to_lowercase();
    let position = terms
        .iter()
        .filter_map(|term| lowered.find(&term.to_lowercase()))
        .min()
        .unwrap_or_default();
    let start = content[..position]
        .char_indices()
        .rev()
        .nth(80)
        .map_or(0, |(index, _)| index);
    content[start..]
        .chars()
        .take(220)
        .collect::<String>()
        .replace('\n', " ")
}

#[tauri::command]
pub fn workspace_search(
    workspace_id: String,
    query: String,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<WorkspaceSearchResponse> {
    let result = (|| {
        let record = registered_workspace(&runtime, &workspace_id)?;
        if !record.trust_level.capabilities().read {
            return Err(AppError::new(
                "workspace.read_denied",
                "This workspace is not readable.",
            ));
        }
        let plan = parse_query(&query)
            .map_err(|error| app_error("search.invalid_query", error.message))?;
        let terms = plan.terms.clone();
        let structured_plan = serde_json::to_string_pretty(&plan)
            .map_err(|error| app_error("search.serialize_failed", error))?;
        let mut results = workspace_text_files(&record)?
            .into_iter()
            .filter(|(path, content)| {
                let path = path.to_lowercase();
                let content = content.to_lowercase();
                terms.iter().all(|term| {
                    let term = term.to_lowercase();
                    path.contains(&term) || content.contains(&term)
                })
            })
            .map(|(path, content)| WorkspaceSearchResult {
                id: format!("{}:{path}", record.id.as_str()),
                title: Path::new(&path)
                    .file_name()
                    .map_or_else(|| path.clone(), |name| name.to_string_lossy().into_owned()),
                snippet: search_snippet(&content, &terms),
                path,
                authority: "explicit_file",
                index_state: "stale",
                reason_codes: vec!["search.path_or_text".to_owned()],
            })
            .collect::<Vec<_>>();
        results.sort_by(|left, right| left.path.cmp(&right.path));
        results.truncate(100);
        Ok(WorkspaceSearchResponse {
            results,
            structured_plan,
        })
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn terminal_start(
    workspace_id: String,
    relative_path: Option<String>,
    preset: Option<PresetId>,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<TerminalSession> {
    let result = (|| {
        let record = registered_workspace(&runtime, &workspace_id)?;
        let path = WorkspacePath::new(record.id.clone(), relative_path.unwrap_or_default())
            .map_err(|error| app_error("terminal.invalid_path", error))?;
        let policy = evaluate_policy(record.trust_level, None, &ApplicationPolicy::default());
        let mut terminals = runtime_terminals(&runtime)?;
        let event = terminals
            .start(
                &record,
                &policy,
                &PathPolicy::default(),
                &path,
                preset.unwrap_or(PresetId::Zsh),
                TerminalSize {
                    columns: 100,
                    rows: 28,
                },
            )
            .map_err(|error| app_error("terminal.start_failed", error))?;
        let crate::terminal::TerminalEvent::Started(terminal_id) = event else {
            return Err(AppError::new(
                "terminal.start_failed",
                "The terminal did not start.",
            ));
        };
        terminals
            .session(&workspace_id, &terminal_id)
            .cloned()
            .map_err(|error| app_error("terminal.session_failed", error))
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn terminal_sessions(
    workspace_id: String,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<Vec<TerminalSession>> {
    let result = (|| {
        let mut terminals = runtime_terminals(&runtime)?;
        let _ = terminals.poll_native_events(128);
        Ok(terminals
            .sessions(&workspace_id)
            .into_iter()
            .cloned()
            .collect())
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn terminal_write(
    workspace_id: String,
    terminal_id: TerminalId,
    input: String,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let result = runtime_terminals(&runtime).and_then(|mut terminals| {
        terminals
            .write(&workspace_id, &terminal_id, input.as_bytes())
            .map_err(|error| app_error("terminal.write_failed", error))
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn terminal_read(
    workspace_id: String,
    terminal_id: TerminalId,
    max_bytes: Option<usize>,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<TerminalOutput> {
    let result = (|| {
        let mut terminals = runtime_terminals(&runtime)?;
        let _ = terminals.poll_native_events(128);
        let output = terminals
            .read_output(
                &workspace_id,
                &terminal_id,
                max_bytes.unwrap_or(64 * 1024).min(256 * 1024),
            )
            .map_err(|error| app_error("terminal.read_failed", error))?;
        Ok(TerminalOutput {
            content: String::from_utf8_lossy(&output.bytes).into_owned(),
            remaining_bytes: output.remaining_bytes,
            dropped_bytes: output.dropped_bytes,
        })
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn terminal_resize(
    workspace_id: String,
    terminal_id: TerminalId,
    columns: u16,
    rows: u16,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let result = runtime_terminals(&runtime).and_then(|mut terminals| {
        terminals
            .resize(&workspace_id, &terminal_id, TerminalSize { columns, rows })
            .map_err(|error| app_error("terminal.resize_failed", error))
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn terminal_terminate(
    workspace_id: String,
    terminal_id: TerminalId,
    confirmed: bool,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let result = runtime_terminals(&runtime).and_then(|mut terminals| {
        terminals
            .terminate(&workspace_id, &terminal_id, confirmed)
            .map_err(|error| app_error("terminal.terminate_failed", error))
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn workspace_graph(
    workspace_id: String,
    relative_path: Option<String>,
    expand_node_id: Option<String>,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<WorkspaceGraphPage> {
    let result = (|| {
        let record = registered_workspace(&runtime, &workspace_id)?;
        if !record.trust_level.capabilities().read {
            return Err(AppError::new(
                "workspace.read_denied",
                "This workspace is not readable.",
            ));
        }

        let requested_path = expand_node_id
            .as_deref()
            .and_then(|node_id| {
                node_id
                    .strip_prefix("fs:dir:")
                    .or_else(|| node_id.strip_prefix("fs:file:"))
            })
            .map_or_else(|| relative_path.unwrap_or_default(), str::to_owned);
        let requested = WorkspacePath::new(record.id.clone(), &requested_path)
            .map_err(|error| app_error("workspace.invalid_path", error))?;
        let validated = PathPolicy::default()
            .validate(&record, &requested)
            .map_err(|error| app_error("workspace.path_denied", error))?;
        let mut nodes = Vec::new();
        let mut edges = Vec::new();

        if validated.canonical_path.is_dir() {
            let include_root = expand_node_id.is_none();
            let parent_id = expand_node_id
                .clone()
                .unwrap_or_else(|| format!("fs:dir:{requested_path}"));
            if include_root {
                let label = requested_path
                    .rsplit('/')
                    .find(|part| !part.is_empty())
                    .map_or_else(|| record.name.clone(), str::to_owned);
                nodes.push(WorkspaceGraphNode {
                    id: parent_id.clone(),
                    label,
                    node_type: "folder".to_owned(),
                    authority: "explicit_file",
                    confidence: 1.0,
                    source: RendererWorkspacePath {
                        workspace_id: record.id.as_str().to_owned(),
                        relative_path: requested_path.clone(),
                    },
                });
            }
            let page = list_directory(&validated, 0, if include_root { 299 } else { 300 }, None)
                .map_err(|error| app_error("workspace.directory_failed", error))?;
            for entry in page.entries {
                let is_directory = entry.kind == FileKind::Directory;
                let id = format!(
                    "fs:{}:{}",
                    if is_directory { "dir" } else { "file" },
                    entry.relative_path
                );
                edges.push(WorkspaceGraphEdge {
                    id: format!("contains:{parent_id}:{id}"),
                    source_id: parent_id.clone(),
                    target_id: id.clone(),
                    edge_type: "contains".to_owned(),
                    authority: "explicit_file",
                    confidence: 1.0,
                });
                let node_type = if is_directory {
                    "folder"
                } else if entry.relative_path.ends_with(".md")
                    || entry.relative_path.ends_with(".mdx")
                    || entry.relative_path.ends_with(".markdown")
                {
                    "note"
                } else {
                    "file"
                };
                nodes.push(WorkspaceGraphNode {
                    id,
                    label: entry.name,
                    node_type: node_type.to_owned(),
                    authority: "explicit_file",
                    confidence: 1.0,
                    source: RendererWorkspacePath {
                        workspace_id: record.id.as_str().to_owned(),
                        relative_path: entry.relative_path,
                    },
                });
            }
        } else {
            let text = read_text(
                &PathPolicy::default(),
                &record,
                &requested,
                Some(512 * 1024),
            )
            .map_err(|error| app_error("workspace.read_failed", error))?;
            if let Some(document) =
                ParserRegistry::standard().parse(record.id.as_str(), &requested_path, &text.content)
            {
                let parent_id =
                    expand_node_id.unwrap_or_else(|| format!("fs:file:{requested_path}"));
                for node in document.nodes {
                    edges.push(WorkspaceGraphEdge {
                        id: format!("contains:{parent_id}:{}", node.node_id),
                        source_id: parent_id.clone(),
                        target_id: node.node_id.clone(),
                        edge_type: "contains".to_owned(),
                        authority: "explicit_file",
                        confidence: 1.0,
                    });
                    nodes.push(WorkspaceGraphNode {
                        id: node.node_id,
                        label: node.label,
                        node_type: node.node_type,
                        authority: node.authority.as_str(),
                        confidence: node.confidence.clamp(0.0, 1.0),
                        source: RendererWorkspacePath {
                            workspace_id: record.id.as_str().to_owned(),
                            relative_path: requested_path.clone(),
                        },
                    });
                }
            }
        }
        Ok(WorkspaceGraphPage {
            nodes,
            edges,
            truncated: false,
        })
    })();
    CommandResult::from_result(result, correlation_id())
}

#[cfg(test)]
mod tests {
    use base64::Engine as _;

    use super::{
        MAX_ATTACHMENT_BYTES, SHELL_LAYOUT_KEY, ShellLayout, attachment_media_type,
        decode_attachment, load_layout, save_layout, system_sample_error, workspace_path,
    };
    use crate::db::Database;
    use rusqlite::params;

    #[test]
    fn shell_layout_round_trips_through_settings() {
        let database = Database::open(":memory:").expect("database");
        let layout = ShellLayout {
            version: 1,
            navigator_width: 24,
            inspector_width: 20,
            navigator_open: true,
            inspector_open: true,
            drawer_open: false,
            drawer_height: 320,
            theme_mode: "dark".to_owned(),
            inspector_tab: "context".to_owned(),
        };
        save_layout(&database, &layout).expect("save");
        let restored = load_layout(&database).expect("load").expect("layout");
        assert_eq!(restored.navigator_width, 24);
        assert!(restored.inspector_open);
    }

    #[test]
    fn shell_layout_v1_payload_migrates_with_safe_v2_defaults() {
        let database = Database::open(":memory:").expect("database");
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO app_settings (key, value_json, schema_version, updated_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        SHELL_LAYOUT_KEY,
                        r#"{
                          "version": 1,
                          "sidebarWidth": 26,
                          "inspectorWidth": 18,
                          "inspectorOpen": false,
                          "drawerOpen": true
                        }"#,
                        1,
                        "2026-08-02T00:00:00Z"
                    ],
                )?;
                Ok(())
            })
            .expect("insert v1 layout");

        let restored = load_layout(&database).expect("load").expect("layout");
        assert_eq!(restored.version, 2);
        assert_eq!(restored.navigator_width, 26);
        assert!(restored.navigator_open);
        assert_eq!(restored.drawer_height, 30);
        assert_eq!(restored.theme_mode, "light");
        assert_eq!(restored.inspector_tab, "overview");
    }

    #[test]
    fn sample_error_uses_the_versioned_ipc_envelope() {
        let value = serde_json::to_value(system_sample_error()).expect("serialize");
        assert_eq!(value["contract"], "ipc_result");
        assert_eq!(value["version"], 1);
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "system.sample_error");
    }

    #[test]
    fn attachment_magic_detection_requires_image_structure() {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend_from_slice(&[0, 0, 0, 13]);
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&[0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
        png.extend_from_slice(&[0, 0, 0, 0]);
        png.extend_from_slice(&[0, 0, 0, 0]);
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0, 0, 0, 0]);
        let gif = [
            b'G', b'I', b'F', b'8', b'9', b'a', 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff,
            0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0, 0x3b,
        ];
        let jpeg = [
            0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xda, 0, 2, 0xff,
            0xd9,
        ];
        let webp = [
            b'R', b'I', b'F', b'F', 18, 0, 0, 0, b'W', b'E', b'B', b'P', b'V', b'P', b'8', b'L', 5,
            0, 0, 0, 0x2f, 1, 0, 0, 0, 0,
        ];

        assert_eq!(attachment_media_type(&png), Some("image/png"));
        assert_eq!(attachment_media_type(&gif), Some("image/gif"));
        assert_eq!(attachment_media_type(&jpeg), Some("image/jpeg"));
        assert_eq!(attachment_media_type(&webp), Some("image/webp"));
        assert_eq!(attachment_media_type(b"\x89PNG\r\n\x1a\n"), None);
        assert_eq!(attachment_media_type(b"plain text"), None);
    }

    #[test]
    fn attachment_decode_rejects_invalid_data_and_size() {
        let invalid = base64::engine::general_purpose::STANDARD.encode(b"not an image");
        let invalid_error = decode_attachment(&invalid).expect_err("not an image");
        assert_eq!(invalid_error.code, "file.attachment_not_image");

        let oversized = vec![0u8; MAX_ATTACHMENT_BYTES + 1];
        let oversized_base64 = base64::engine::general_purpose::STANDARD.encode(oversized);
        let oversized_error = decode_attachment(&oversized_base64).expect_err("oversized");
        assert_eq!(oversized_error.code, "file.attachment_too_large");
    }

    #[test]
    fn attachment_path_rejects_absolute_renderer_paths() {
        let path = super::RendererWorkspacePath {
            workspace_id: "workspace".into(),
            relative_path: "/tmp/image.png".into(),
        };
        assert!(workspace_path(&path).is_err());
    }
}
