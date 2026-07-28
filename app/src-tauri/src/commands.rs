use crate::db::Database;
use crate::errors::{AppError, AppResult};
use crate::knowledge::parser::ParserRegistry;
use crate::knowledge::search::parse_query;
use crate::platform::{Clock, SystemClock, ensure_application_data_dir};
use crate::terminal::{
    NativePtyAdapter, PresetId, TerminalId, TerminalManager, TerminalSession, TerminalSize,
};
use crate::workspace::git::GitAdapter;
use crate::workspace::mutations::{MutationActor, MutationService};
use crate::workspace::{
    ApplicationPolicy, FileKind, PathPolicy, RegisterWorkspace, TrustLevel, WorkspaceId,
    WorkspaceKind, WorkspacePath, WorkspaceRegistry, evaluate_policy, list_directory, read_text,
};
use ignore::WalkBuilder;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use tauri::State;

const IPC_CONTRACT: &str = "ipc_result";
const IPC_VERSION: u32 = 1;
const SHELL_LAYOUT_KEY: &str = "shell.layout";
const WORKSPACES_KEY: &str = "workspace.registry.v1";

/// Process-local application state. The domain registry deliberately stays
/// independent of Tauri; this adapter is the only place that grants renderer
/// requests access to registered workspace records.
pub struct AppRuntime {
    workspaces: Mutex<WorkspaceRegistry>,
    terminals: Mutex<TerminalManager<NativePtyAdapter>>,
}

impl AppRuntime {
    #[must_use]
    pub fn load() -> Self {
        let workspaces = load_workspace_registry().unwrap_or_default();
        Self {
            workspaces: Mutex::new(workspaces),
            terminals: Mutex::new(TerminalManager::new(NativePtyAdapter::new())),
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
    pub version: u32,
    pub sidebar_width: u32,
    pub inspector_width: u32,
    pub inspector_open: bool,
    pub drawer_open: bool,
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
        .transpose()
}

fn save_layout(database: &Database, layout: &ShellLayout) -> AppResult<()> {
    let value = serde_json::to_string(layout).map_err(|error| {
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
            let page = list_directory(&validated, 0, 300, None)
                .map_err(|error| app_error("workspace.directory_failed", error))?;
            for entry in page.entries {
                let is_directory = entry.kind == FileKind::Directory;
                let id = format!(
                    "fs:{}:{}",
                    if is_directory { "dir" } else { "file" },
                    entry.relative_path
                );
                if let Some(parent_id) = expand_node_id.as_ref() {
                    edges.push(WorkspaceGraphEdge {
                        id: format!("contains:{parent_id}:{id}"),
                        source_id: parent_id.clone(),
                        target_id: id.clone(),
                        edge_type: "contains".to_owned(),
                        authority: "explicit_file",
                        confidence: 1.0,
                    });
                }
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
    use super::{ShellLayout, load_layout, save_layout, system_sample_error};
    use crate::db::Database;

    #[test]
    fn shell_layout_round_trips_through_settings() {
        let database = Database::open(":memory:").expect("database");
        let layout = ShellLayout {
            version: 1,
            sidebar_width: 24,
            inspector_width: 20,
            inspector_open: true,
            drawer_open: false,
        };
        save_layout(&database, &layout).expect("save");
        let restored = load_layout(&database).expect("load").expect("layout");
        assert_eq!(restored.sidebar_width, 24);
        assert!(restored.inspector_open);
    }

    #[test]
    fn sample_error_uses_the_versioned_ipc_envelope() {
        let value = serde_json::to_value(system_sample_error()).expect("serialize");
        assert_eq!(value["contract"], "ipc_result");
        assert_eq!(value["version"], 1);
        assert_eq!(value["ok"], false);
        assert_eq!(value["error"]["code"], "system.sample_error");
    }
}
