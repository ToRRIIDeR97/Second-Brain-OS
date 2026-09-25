use crate::agents::live_codex::{
    AgentSessionSnapshot, CodexAppServerRuntime, ManagedApprovalDecisionRequest, ManagedSandbox,
    ManagedSessionMessageRequest, ManagedSessionRequest, ProviderProbe, StartManagedSession,
    list_persisted_sessions, mark_orphaned_sessions_recoverable,
};
use crate::db::Database;
use crate::errors::{AppError, AppResult, redact_text};
use crate::events::{Actor, EventBus, EventEnvelope, EventKind, RedactionClass};
use crate::knowledge::parser::ParserRegistry;
use crate::knowledge::search::parse_query;
use crate::planner::google::{CalendarEvent, GoogleTask, SyncCursor, sync_calendar, sync_tasks};
use crate::planner::google_live::{
    GOOGLE_ACCOUNT_ID, GOOGLE_CREDENTIAL_KEY, GoogleAccess, LiveGoogleProvider,
    authorize as authorize_google, delete_refresh_token, load_client_secret, load_refresh_token,
    provider_to_app_error, revoke as revoke_google, store_client_secret, store_refresh_token,
};
use crate::planner::local::DateOnly;
use crate::platform::{
    Clock, IdGenerator, SystemClock, UlidGenerator, ensure_application_data_dir,
};
use crate::terminal::{
    NativePtyAdapter, PresetId, TerminalId, TerminalManager, TerminalSession, TerminalSize,
};
use crate::workspace::git::GitAdapter;
use crate::workspace::language_tools::{
    Diagnostic, FormatResult, LanguageToolService, ToolLanguage, ToolStatus,
};
use crate::workspace::lsp::{LspError, LspManager, LspServerKind, LspSessionId, LspSessionSummary};
use crate::workspace::mutations::{MutationActor, MutationService};
use crate::workspace::project::{
    CreateProject, ProjectCatalog, ProjectId, ProjectLocation, ProjectPatch, ProjectRecord,
    ProjectStatus,
};
use crate::workspace::{
    ApplicationPolicy, FileKind, PathPolicy, ReadError, RegisterWorkspace, TrustLevel, WorkspaceId,
    WorkspaceKind, WorkspacePath, WorkspaceRegistry, evaluate_policy, list_directory, open_file,
    read_text,
};
use base64::Engine as _;
use ignore::WalkBuilder;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const IPC_CONTRACT: &str = "ipc_result";
const IPC_VERSION: u32 = 1;
const SHELL_LAYOUT_KEY: &str = "shell.layout";
const WORKSPACES_KEY: &str = "workspace.registry.v1";
const INTEGRATION_SETTINGS_KEY: &str = "integrations.settings.v1";
const INTEGRATION_SETTINGS_VERSION: u32 = 1;
const MAX_GOOGLE_CLIENT_ID_CHARS: usize = 512;
const MAX_GOOGLE_CLIENT_SECRET_CHARS: usize = 512;
const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64_BYTES: usize = MAX_ATTACHMENT_BYTES.div_ceil(3) * 4;
const MAX_DIAGNOSTIC_SOURCE_CHARS: usize = 64;
const MAX_DIAGNOSTIC_TEXT_CHARS: usize = 2_048;
const ROOT_GRANT_LIFETIME: Duration = Duration::from_secs(5 * 60);

#[derive(Debug)]
struct RootSelectionGrant {
    canonical_path: PathBuf,
    display_path: String,
    expires_at: Instant,
}

/// Process-local application state. The domain registry deliberately stays
/// independent of Tauri; this adapter is the only place that grants renderer
/// requests access to registered workspace records.
pub struct AppRuntime {
    workspaces: Mutex<WorkspaceRegistry>,
    root_selection_grants: Mutex<BTreeMap<String, RootSelectionGrant>>,
    database: Option<Database>,
    events: EventBus,
    agents: Mutex<CodexAppServerRuntime>,
    google_operation_active: AtomicBool,
    terminals: Mutex<TerminalManager<NativePtyAdapter>>,
    lsp: Mutex<LspManager>,
}

impl AppRuntime {
    #[must_use]
    pub fn load() -> Self {
        let workspaces = load_workspace_registry().unwrap_or_default();
        let database = database().ok();
        let events = EventBus::with_audit_sink(
            database
                .clone()
                .map(|database| Arc::new(database) as Arc<dyn crate::events::AuditSink>),
        );
        if let Some(database) = database.as_ref() {
            let _ = mark_orphaned_sessions_recoverable(database);
        }
        Self {
            workspaces: Mutex::new(workspaces),
            root_selection_grants: Mutex::new(BTreeMap::new()),
            database,
            events,
            agents: Mutex::new(CodexAppServerRuntime::new()),
            google_operation_active: AtomicBool::new(false),
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
    /// Display-only echo. Filesystem authority comes from `root_grant_id`.
    pub root_path: String,
    pub root_grant_id: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootSelection {
    pub grant_id: String,
    pub display_path: String,
    pub suggested_name: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GoogleConsentMode {
    ReadOnly,
    ReadWrite,
}

impl Default for GoogleConsentMode {
    fn default() -> Self {
        Self::ReadOnly
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GoogleIntegrationSettings {
    pub oauth_client_id: Option<String>,
    pub consent_mode: GoogleConsentMode,
    pub calendar_enabled: bool,
    pub tasks_enabled: bool,
}

impl Default for GoogleIntegrationSettings {
    fn default() -> Self {
        Self {
            oauth_client_id: None,
            consent_mode: GoogleConsentMode::ReadOnly,
            calendar_enabled: true,
            tasks_enabled: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CodexIntegrationSettings {
    pub default_sandbox: ManagedSandbox,
}

impl Default for CodexIntegrationSettings {
    fn default() -> Self {
        Self {
            default_sandbox: ManagedSandbox::ReadOnly,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct IntegrationSettings {
    pub version: u32,
    pub google: GoogleIntegrationSettings,
    pub codex: CodexIntegrationSettings,
}

impl Default for IntegrationSettings {
    fn default() -> Self {
        Self {
            version: INTEGRATION_SETTINGS_VERSION,
            google: GoogleIntegrationSettings::default(),
            codex: CodexIntegrationSettings::default(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationSettingsUpdate {
    pub google: GoogleIntegrationSettingsUpdate,
    pub codex: CodexIntegrationSettings,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GoogleIntegrationSettingsUpdate {
    pub oauth_client_id: Option<String>,
    pub oauth_client_secret: Option<String>,
    pub consent_mode: GoogleConsentMode,
    pub calendar_enabled: bool,
    pub tasks_enabled: bool,
}

impl Default for GoogleIntegrationSettingsUpdate {
    fn default() -> Self {
        Self {
            oauth_client_id: None,
            oauth_client_secret: None,
            consent_mode: GoogleConsentMode::ReadOnly,
            calendar_enabled: true,
            tasks_enabled: true,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleConnectionStatus {
    pub state: String,
    pub connected: bool,
    pub client_secret_configured: bool,
    pub consent_mode: GoogleConsentMode,
    pub calendar_enabled: bool,
    pub tasks_enabled: bool,
    pub last_synced_at: Option<String>,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleSyncSummary {
    pub calendar_items: usize,
    pub task_items: usize,
    pub task_lists: usize,
    pub last_synced_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum ProjectLocationInput {
    None,
    ExistingWorkspace {
        workspace_id: String,
    },
    RootSelection {
        grant_id: String,
        trust_level: TrustLevel,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateRequest {
    pub brain_workspace_id: String,
    pub name: String,
    pub outcome: String,
    pub template_id: Option<String>,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub location: ProjectLocationInput,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdateRequest {
    pub brain_workspace_id: String,
    pub project_id: String,
    pub patch: ProjectPatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectReadRequest {
    pub brain_workspace_id: String,
    pub project_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatusRequest {
    pub brain_workspace_id: String,
    pub project_id: String,
    pub status: ProjectStatus,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityListRequest {
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    pub category: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub id: String,
    pub event_type: String,
    pub timestamp: String,
    pub workspace_id: Option<String>,
    pub correlation_id: String,
    pub actor_type: String,
    pub category: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPage {
    pub items: Vec<ActivityItem>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum PlannerScheduleRecord {
    DateOnly {
        date: String,
    },
    AllDay {
        date: String,
    },
    Exact {
        start_epoch_seconds: i64,
        end_epoch_seconds: Option<i64>,
        timezone: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerSourceLinkRecord {
    pub workspace_id: String,
    pub relative_path: String,
    pub start_line: Option<u32>,
    pub end_line: Option<u32>,
    pub explicit_task_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerProviderLinkRecord {
    pub provider: String,
    pub object_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerItemRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub details: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    pub schedule: Option<PlannerScheduleRecord>,
    pub status: String,
    pub project_id: Option<String>,
    pub source: String,
    pub source_link: Option<PlannerSourceLinkRecord>,
    pub provider_link: Option<PlannerProviderLinkRecord>,
    pub recurrence_rule: Option<String>,
    pub sync_status: String,
    pub conflict_message: Option<String>,
    pub created_at_epoch_seconds: i64,
    pub updated_at_epoch_seconds: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerListRequest {
    pub brain_workspace_id: String,
    pub project_id: Option<String>,
    pub range: Option<PlannerListRangeRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerListRangeRecord {
    pub start_date: String,
    pub end_date: String,
    pub start_epoch_seconds: i64,
    pub end_epoch_seconds: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerItemDraftRecord {
    pub kind: Option<String>,
    pub title: String,
    pub details: Option<String>,
    pub location: Option<String>,
    pub schedule: Option<PlannerScheduleRecord>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerCreateRequest {
    pub brain_workspace_id: String,
    pub draft: PlannerItemDraftRecord,
    pub sync_target: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerItemPatchRecord {
    pub title: Option<String>,
    pub details: Option<String>,
    pub clear_details: Option<bool>,
    pub location: Option<String>,
    pub clear_location: Option<bool>,
    pub schedule: Option<PlannerScheduleRecord>,
    pub clear_schedule: Option<bool>,
    pub status: Option<String>,
    pub project_id: Option<String>,
    pub clear_project: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerUpdateRequest {
    pub brain_workspace_id: String,
    pub item_id: String,
    pub patch: PlannerItemPatchRecord,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerDeleteRequest {
    pub brain_workspace_id: String,
    pub item_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlannerLocalSnapshot {
    schema_version: u32,
    item: PlannerItemRecord,
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

fn load_integration_settings(database: &Database) -> AppResult<IntegrationSettings> {
    let value = database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                [INTEGRATION_SETTINGS_KEY],
                |row| row.get::<_, String>(0),
            )
            .optional()
    })?;
    let Some(value) = value else {
        return Ok(IntegrationSettings::default());
    };
    serde_json::from_str(&value).map_err(|error| {
        AppError::new(
            "settings.invalid",
            "The saved integration settings could not be read.",
        )
        .with_details(serde_json::Value::String(error.to_string()))
    })
}

fn normalize_google_client_id(value: Option<String>) -> AppResult<Option<String>> {
    let Some(value) = value.map(|value| value.trim().to_owned()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > MAX_GOOGLE_CLIENT_ID_CHARS
        || value.chars().any(char::is_whitespace)
        || !value.ends_with(".apps.googleusercontent.com")
    {
        return Err(AppError::new(
            "settings.google_client_id_invalid",
            "Enter a valid Google OAuth client ID ending in .apps.googleusercontent.com.",
        ));
    }
    Ok(Some(value))
}

fn normalize_google_client_secret(value: Option<String>) -> AppResult<Option<String>> {
    let Some(value) = value.map(|value| value.trim().to_owned()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    if value.chars().count() > MAX_GOOGLE_CLIENT_SECRET_CHARS
        || value.chars().any(char::is_whitespace)
    {
        return Err(AppError::new(
            "settings.google_client_secret_invalid",
            "Enter the client secret exactly as it appears in the Google Desktop OAuth JSON.",
        ));
    }
    Ok(Some(value))
}

fn save_integration_settings(
    database: &Database,
    update: IntegrationSettingsUpdate,
) -> AppResult<IntegrationSettings> {
    let previous_google = load_integration_settings(database)?.google;
    let GoogleIntegrationSettingsUpdate {
        oauth_client_id,
        oauth_client_secret,
        consent_mode,
        calendar_enabled,
        tasks_enabled,
    } = update.google;
    let oauth_client_id = normalize_google_client_id(oauth_client_id)?;
    let oauth_client_secret = normalize_google_client_secret(oauth_client_secret)?;
    if let Some(client_secret) = oauth_client_secret.as_deref() {
        let client_id = oauth_client_id.as_deref().ok_or_else(|| {
            AppError::new(
                "google.client_id_required",
                "Enter the Google Desktop OAuth client ID before saving its secret.",
            )
        })?;
        store_client_secret(client_id, client_secret)?;
    }
    let settings = IntegrationSettings {
        version: INTEGRATION_SETTINGS_VERSION,
        google: GoogleIntegrationSettings {
            oauth_client_id,
            consent_mode,
            calendar_enabled,
            tasks_enabled,
        },
        codex: update.codex,
    };
    let value = serde_json::to_string(&settings).map_err(|error| {
        AppError::new(
            "settings.serialize",
            "The integration settings could not be saved.",
        )
        .with_details(serde_json::Value::String(error.to_string()))
    })?;
    let google_changed = previous_google != settings.google || oauth_client_secret.is_some();
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO app_settings (key, value_json, schema_version, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               schema_version = excluded.schema_version,
               updated_at = excluded.updated_at",
            params![
                INTEGRATION_SETTINGS_KEY,
                value,
                INTEGRATION_SETTINGS_VERSION,
                SystemClock.now_utc()
            ],
        )?;
        if google_changed {
            connection.execute(
                "UPDATE planner_accounts SET connection_state = 'needs_reconnect'
                 WHERE account_id = ?1 AND connection_state = 'connected'",
                [GOOGLE_ACCOUNT_ID],
            )?;
        }
        Ok(())
    })?;
    Ok(settings)
}

fn google_access(settings: &GoogleIntegrationSettings) -> GoogleAccess {
    GoogleAccess {
        read_write: settings.consent_mode == GoogleConsentMode::ReadWrite,
        calendar_enabled: settings.calendar_enabled,
        tasks_enabled: settings.tasks_enabled,
    }
}

fn google_client_id(settings: &GoogleIntegrationSettings) -> AppResult<&str> {
    settings.oauth_client_id.as_deref().ok_or_else(|| {
        AppError::new(
            "google.client_id_required",
            "Save a Google Desktop OAuth client ID before connecting.",
        )
    })
}

fn google_client_secret(client_id: &str) -> AppResult<String> {
    load_client_secret(client_id)?.ok_or_else(|| {
        AppError::new(
            "google.client_secret_required",
            "Save the client secret from the matching Google Desktop OAuth JSON before connecting.",
        )
    })
}

fn google_connection_status(
    database: &Database,
    operation_active: bool,
) -> AppResult<GoogleConnectionStatus> {
    let settings = load_integration_settings(database)?.google;
    let account_state = database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT connection_state FROM planner_accounts WHERE account_id = ?1",
                [GOOGLE_ACCOUNT_ID],
                |row| row.get::<_, String>(0),
            )
            .optional()
    })?;
    let last_synced_at = database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT MAX(last_synced_at) FROM planner_sync_cursors WHERE account_id = ?1",
                [GOOGLE_ACCOUNT_ID],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map(|value| value.flatten())
    })?;
    let has_credential = load_refresh_token()?.is_some();
    let has_client_id = settings.oauth_client_id.is_some();
    let client_secret_configured = match settings.oauth_client_id.as_deref() {
        Some(client_id) => load_client_secret(client_id)?.is_some(),
        None => false,
    };
    let configured = has_client_id && client_secret_configured;
    let connected = configured && has_credential && account_state.as_deref() == Some("connected");
    let (state, message) = if operation_active {
        (
            "connecting",
            "A Google connection or synchronization is in progress.",
        )
    } else if !has_client_id {
        (
            "not_configured",
            "Add and save a Desktop OAuth client ID to connect Google.",
        )
    } else if !client_secret_configured {
        (
            "not_configured",
            "Add the client secret from the matching Desktop OAuth JSON.",
        )
    } else if connected {
        (
            "connected",
            "Google Calendar and Tasks are connected to Planner.",
        )
    } else if account_state.as_deref() == Some("error") {
        (
            "error",
            "The Google connection needs attention. Connect it again.",
        )
    } else {
        (
            "disconnected",
            "OAuth is configured. Connect your Google account to start syncing.",
        )
    };
    Ok(GoogleConnectionStatus {
        state: state.into(),
        connected,
        client_secret_configured,
        consent_mode: settings.consent_mode,
        calendar_enabled: settings.calendar_enabled,
        tasks_enabled: settings.tasks_enabled,
        last_synced_at,
        message: message.into(),
    })
}

fn upsert_google_account(
    database: &Database,
    settings: &GoogleIntegrationSettings,
) -> AppResult<()> {
    let now = SystemClock.now_utc();
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO planner_accounts (
                account_id, provider, provider_subject, consent_mode, credential_key,
                connection_state, connected_at, disconnected_at
             ) VALUES (?1, 'google', 'primary', ?2, ?3, 'connected', ?4, NULL)
             ON CONFLICT(account_id) DO UPDATE SET
                consent_mode = excluded.consent_mode,
                credential_key = excluded.credential_key,
                connection_state = 'connected',
                connected_at = excluded.connected_at,
                disconnected_at = NULL",
            params![
                GOOGLE_ACCOUNT_ID,
                if settings.consent_mode == GoogleConsentMode::ReadWrite {
                    "write"
                } else {
                    "read"
                },
                GOOGLE_CREDENTIAL_KEY,
                now,
            ],
        )?;
        Ok(())
    })
}

fn mark_google_disconnected(database: &Database) -> AppResult<()> {
    let now = SystemClock.now_utc();
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE planner_accounts SET connection_state = 'disconnected', disconnected_at = ?2
             WHERE account_id = ?1",
            params![GOOGLE_ACCOUNT_ID, now],
        )?;
        Ok(())
    })
}

fn load_google_cursor(
    database: &Database,
    scope_kind: &str,
    scope_id: &str,
) -> AppResult<SyncCursor> {
    let sync_token = database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT cursor FROM planner_sync_cursors
                 WHERE account_id = ?1 AND scope_kind = ?2 AND scope_id = ?3",
                params![GOOGLE_ACCOUNT_ID, scope_kind, scope_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map(|value| value.flatten())
    })?;
    Ok(SyncCursor {
        sync_token,
        page_token: None,
        generation: 0,
    })
}

fn save_google_cursor(
    database: &Database,
    scope_kind: &str,
    scope_id: &str,
    cursor: &SyncCursor,
    synced_at: &str,
) -> AppResult<()> {
    database.with_connection(|connection| {
        connection.execute(
            "INSERT INTO planner_sync_cursors (
                account_id, scope_kind, scope_id, cursor, last_synced_at, state
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'ready')
             ON CONFLICT(account_id, scope_kind, scope_id) DO UPDATE SET
                cursor = excluded.cursor,
                last_synced_at = excluded.last_synced_at,
                state = 'ready'",
            params![
                GOOGLE_ACCOUNT_ID,
                scope_kind,
                scope_id,
                cursor.sync_token,
                synced_at,
            ],
        )?;
        Ok(())
    })
}

fn truncate_chars(value: String, limit: usize) -> String {
    if value.chars().count() <= limit {
        value
    } else {
        value.chars().take(limit).collect()
    }
}

fn google_updated_epoch(value: &str, fallback: i64) -> i64 {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .map(|value| value.unix_timestamp())
        .unwrap_or(fallback)
}

fn google_exact_schedule(
    start: &str,
    end: &str,
    timezone: Option<&str>,
) -> Option<PlannerScheduleRecord> {
    let start_epoch_seconds =
        time::OffsetDateTime::parse(start, &time::format_description::well_known::Rfc3339)
            .ok()?
            .unix_timestamp();
    let end_epoch_seconds =
        time::OffsetDateTime::parse(end, &time::format_description::well_known::Rfc3339)
            .ok()
            .map(|value| value.unix_timestamp());
    Some(PlannerScheduleRecord::Exact {
        start_epoch_seconds,
        end_epoch_seconds,
        timezone: timezone.unwrap_or("UTC").to_owned(),
    })
}

fn planner_item_from_google_event(event: &CalendarEvent) -> PlannerItemRecord {
    let now = now_epoch_seconds();
    let object_id = format!("calendar:primary:{}", event.provider_id);
    let title = if event.title.trim().is_empty() {
        "Untitled event".into()
    } else {
        truncate_chars(event.title.trim().to_owned(), 240)
    };
    PlannerItemRecord {
        id: format!(
            "planner_google_{}",
            &blake3::hash(object_id.as_bytes()).to_hex()[..24]
        ),
        kind: "calendar".into(),
        title,
        details: event
            .description
            .as_ref()
            .map(|value| truncate_chars(value.clone(), 20_000)),
        location: event
            .location
            .as_ref()
            .map(|value| truncate_chars(value.clone(), 500)),
        schedule: if event.all_day {
            DateOnly::new(&event.start)
                .ok()
                .map(|_| PlannerScheduleRecord::AllDay {
                    date: event.start.clone(),
                })
        } else {
            google_exact_schedule(&event.start, &event.end, event.timezone.as_deref())
        },
        status: if event.deleted { "archived" } else { "open" }.into(),
        project_id: None,
        source: "provider".into(),
        source_link: None,
        provider_link: Some(PlannerProviderLinkRecord {
            provider: "google".into(),
            object_id,
        }),
        recurrence_rule: event.recurring_series_id.clone(),
        sync_status: "synced".into(),
        conflict_message: None,
        created_at_epoch_seconds: now,
        updated_at_epoch_seconds: google_updated_epoch(&event.updated_at, now),
    }
}

fn planner_item_from_google_task(task: &GoogleTask) -> PlannerItemRecord {
    let now = now_epoch_seconds();
    let object_id = format!("tasks:{}:{}", task.task_list_id, task.provider_id);
    let title = if task.title.trim().is_empty() {
        "Untitled task".into()
    } else {
        truncate_chars(task.title.trim().to_owned(), 240)
    };
    let due_date = task
        .due_date
        .as_deref()
        .and_then(|value| value.get(..10))
        .filter(|value| DateOnly::new(*value).is_ok())
        .map(ToOwned::to_owned);
    PlannerItemRecord {
        id: format!(
            "planner_google_{}",
            &blake3::hash(object_id.as_bytes()).to_hex()[..24]
        ),
        kind: "task".into(),
        title,
        details: task
            .notes
            .as_ref()
            .map(|value| truncate_chars(value.clone(), 20_000)),
        location: None,
        schedule: due_date.map(|date| PlannerScheduleRecord::DateOnly { date }),
        status: if task.deleted {
            "archived"
        } else if task.status == "completed" {
            "completed"
        } else {
            "open"
        }
        .into(),
        project_id: None,
        source: "provider".into(),
        source_link: None,
        provider_link: Some(PlannerProviderLinkRecord {
            provider: "google".into(),
            object_id,
        }),
        recurrence_rule: None,
        sync_status: "synced".into(),
        conflict_message: None,
        created_at_epoch_seconds: now,
        updated_at_epoch_seconds: google_updated_epoch(&task.updated_at, now),
    }
}

fn planner_upsert_google_item(
    database: &Database,
    brain_workspace_id: &str,
    mut item: PlannerItemRecord,
    provider_etag: Option<&str>,
    provider_hash: &str,
) -> AppResult<()> {
    validate_planner_item(&item)?;
    let object_id = item
        .provider_link
        .as_ref()
        .map(|link| link.object_id.as_str())
        .ok_or_else(|| AppError::new("google.item_invalid", "A Google item link was missing."))?;
    let existing = database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT item_id, created_at FROM planner_items
                 WHERE provider = 'google' AND provider_item_id = ?1",
                [object_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
    })?;
    if let Some((item_id, created_at)) = existing.as_ref() {
        item.id.clone_from(item_id);
        item.created_at_epoch_seconds = created_at.parse().unwrap_or(item.created_at_epoch_seconds);
    }
    let value = serde_json::to_string(&PlannerLocalSnapshot {
        schema_version: 1,
        item: item.clone(),
    })
    .map_err(|_| {
        AppError::new(
            "planner.serialize_failed",
            "The Google planner item could not be saved.",
        )
    })?;
    let provider_fields = serde_json::json!({
        "schemaVersion": 1,
        "payloadHash": provider_hash,
    })
    .to_string();
    let (schedule_kind, scheduled_value, timezone) =
        planner_schedule_columns(item.schedule.as_ref());
    database.with_connection(|connection| {
        if existing.is_some() {
            connection.execute(
                "UPDATE planner_items SET
                    workspace_id = ?2, kind = ?3, project_id = ?4, title = ?5,
                    status = ?6, schedule_kind = ?7, scheduled_value = ?8,
                    timezone = ?9, local_enrichment_json = ?10,
                    provider_fields_json = ?11, provider_etag = ?12,
                    sync_status = 'synced', conflict_status = 'none', updated_at = ?13
                 WHERE provider = 'google' AND provider_item_id = ?1",
                params![
                    object_id,
                    brain_workspace_id,
                    item.kind,
                    item.project_id,
                    item.title,
                    item.status,
                    schedule_kind,
                    scheduled_value,
                    timezone,
                    value,
                    provider_fields,
                    provider_etag,
                    item.updated_at_epoch_seconds.to_string(),
                ],
            )?;
        } else {
            connection.execute(
                "INSERT INTO planner_items (
                    item_id, workspace_id, kind, provider, provider_item_id, project_id,
                    title, status, schedule_kind, scheduled_value, timezone,
                    source_document_id, source_task_id, source_start_line, source_end_line,
                    local_enrichment_json, provider_fields_json, provider_etag, sync_status,
                    conflict_status, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, 'google', ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    NULL, NULL, NULL, NULL, ?11, ?12, ?13, 'synced', 'none', ?14, ?15
                 )",
                params![
                    item.id,
                    brain_workspace_id,
                    item.kind,
                    object_id,
                    item.project_id,
                    item.title,
                    item.status,
                    schedule_kind,
                    scheduled_value,
                    timezone,
                    value,
                    provider_fields,
                    provider_etag,
                    item.created_at_epoch_seconds.to_string(),
                    item.updated_at_epoch_seconds.to_string(),
                ],
            )?;
        }
        Ok(())
    })
}

fn sync_google(database: &Database, brain_workspace_id: &str) -> AppResult<GoogleSyncSummary> {
    let settings = load_integration_settings(database)?.google;
    let client_id = google_client_id(&settings)?;
    let client_secret = google_client_secret(client_id)?;
    let refresh_token = load_refresh_token()?.ok_or_else(|| {
        AppError::new(
            "google.connection_required",
            "Connect your Google account in Settings before syncing.",
        )
    })?;
    let mut provider = LiveGoogleProvider::connect(client_id, &client_secret, &refresh_token)?;
    let synced_at = SystemClock.now_utc();
    let mut calendar_items = 0;
    let mut task_items = 0;
    let mut task_lists = 0;
    if settings.calendar_enabled {
        let cursor = load_google_cursor(database, "calendar", "primary")?;
        let outcome =
            sync_calendar(&mut provider, "primary", cursor).map_err(provider_to_app_error)?;
        if outcome.reset {
            database.with_connection(|connection| {
                connection.execute(
                    "DELETE FROM planner_items
                     WHERE provider = 'google' AND provider_item_id LIKE 'calendar:primary:%'",
                    [],
                )?;
                Ok(())
            })?;
        }
        calendar_items = outcome.items.len();
        for event in &outcome.items {
            planner_upsert_google_item(
                database,
                brain_workspace_id,
                planner_item_from_google_event(event),
                event.etag.as_deref(),
                &event.payload_hash,
            )?;
        }
        save_google_cursor(database, "calendar", "primary", &outcome.cursor, &synced_at)?;
    }
    if settings.tasks_enabled {
        let lists = provider.task_lists()?;
        task_lists = lists.len();
        for list in lists {
            let cursor = load_google_cursor(database, "tasks", &list.provider_id)?;
            let outcome = sync_tasks(&mut provider, &list.provider_id, cursor)
                .map_err(provider_to_app_error)?;
            task_items += outcome.items.len();
            for task in &outcome.items {
                planner_upsert_google_item(
                    database,
                    brain_workspace_id,
                    planner_item_from_google_task(task),
                    task.etag.as_deref(),
                    &task.payload_hash,
                )?;
            }
            save_google_cursor(
                database,
                "tasks",
                &list.provider_id,
                &outcome.cursor,
                &synced_at,
            )?;
        }
    }
    Ok(GoogleSyncSummary {
        calendar_items,
        task_items,
        task_lists,
        last_synced_at: synced_at,
    })
}

fn google_write_provider(database: &Database, kind: &str) -> AppResult<LiveGoogleProvider> {
    let settings = load_integration_settings(database)?.google;
    if settings.consent_mode != GoogleConsentMode::ReadWrite {
        return Err(AppError::new(
            "google.write_access_required",
            "Turn on read and write access in Google connection settings, then reconnect.",
        ));
    }
    let enabled = match kind {
        "task" => settings.tasks_enabled,
        "calendar" => settings.calendar_enabled,
        _ => false,
    };
    if !enabled {
        return Err(AppError::new(
            "google.service_disabled",
            "Turn on the matching Google service in connection settings.",
        ));
    }
    let client_id = google_client_id(&settings)?;
    let client_secret = google_client_secret(client_id)?;
    let refresh_token = load_refresh_token()?.ok_or_else(|| {
        AppError::new(
            "google.connection_required",
            "Connect your Google account in Settings before making this change.",
        )
    })?;
    LiveGoogleProvider::connect(client_id, &client_secret, &refresh_token)
}

fn google_task_due(schedule: Option<&PlannerScheduleRecord>) -> AppResult<Option<String>> {
    let date = match schedule {
        None => return Ok(None),
        Some(PlannerScheduleRecord::DateOnly { date })
        | Some(PlannerScheduleRecord::AllDay { date }) => date.clone(),
        Some(PlannerScheduleRecord::Exact {
            start_epoch_seconds,
            ..
        }) => time::OffsetDateTime::from_unix_timestamp(*start_epoch_seconds)
            .map_err(|_| AppError::new("planner.schedule_invalid", "Check the task date."))?
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|_| AppError::new("planner.schedule_invalid", "Check the task date."))?
            .chars()
            .take(10)
            .collect(),
    };
    Ok(Some(format!("{date}T00:00:00.000Z")))
}

fn next_google_date(value: &str) -> AppResult<String> {
    let mut parts = value.split('-');
    let year = parts.next().and_then(|part| part.parse::<i32>().ok());
    let month = parts.next().and_then(|part| part.parse::<u8>().ok());
    let day = parts.next().and_then(|part| part.parse::<u8>().ok());
    let (Some(year), Some(month), Some(day)) = (year, month, day) else {
        return Err(AppError::new(
            "planner.date_invalid",
            "Check the calendar date.",
        ));
    };
    let month = time::Month::try_from(month)
        .map_err(|_| AppError::new("planner.date_invalid", "Check the calendar date."))?;
    time::Date::from_calendar_date(year, month, day)
        .ok()
        .and_then(time::Date::next_day)
        .map(|date| date.to_string())
        .ok_or_else(|| AppError::new("planner.date_invalid", "Check the calendar date."))
}

fn google_event_payload(item: &PlannerItemRecord) -> AppResult<serde_json::Value> {
    let (start, end) = match item.schedule.as_ref() {
        Some(PlannerScheduleRecord::DateOnly { date })
        | Some(PlannerScheduleRecord::AllDay { date }) => (
            serde_json::json!({ "date": date }),
            serde_json::json!({ "date": next_google_date(date)? }),
        ),
        Some(PlannerScheduleRecord::Exact {
            start_epoch_seconds,
            end_epoch_seconds,
            timezone,
        }) => {
            let format_epoch = |epoch| {
                time::OffsetDateTime::from_unix_timestamp(epoch)
                    .map_err(|_| {
                        AppError::new("planner.schedule_invalid", "Check the event time.")
                    })?
                    .format(&time::format_description::well_known::Rfc3339)
                    .map_err(|_| AppError::new("planner.schedule_invalid", "Check the event time."))
            };
            let end_epoch = end_epoch_seconds.unwrap_or(start_epoch_seconds + 3_600);
            (
                serde_json::json!({
                    "dateTime": format_epoch(*start_epoch_seconds)?,
                    "timeZone": timezone,
                }),
                serde_json::json!({
                    "dateTime": format_epoch(end_epoch)?,
                    "timeZone": timezone,
                }),
            )
        }
        None => {
            return Err(AppError::new(
                "planner.schedule_required",
                "Choose a date or time for the calendar event.",
            ));
        }
    };
    Ok(serde_json::json!({
        "summary": item.title,
        "description": item.details,
        "location": item.location,
        "start": start,
        "end": end,
    }))
}

fn create_google_planner_item(
    database: &Database,
    brain_workspace_id: &str,
    draft: PlannerItemDraftRecord,
) -> AppResult<PlannerItemRecord> {
    let now = now_epoch_seconds();
    let kind = draft.kind.unwrap_or_else(|| "task".into());
    let candidate = PlannerItemRecord {
        id: format!("planner_{}", UlidGenerator.next_id()),
        kind: kind.clone(),
        title: draft.title.trim().to_owned(),
        details: draft.details,
        location: draft.location,
        schedule: draft.schedule,
        status: "open".into(),
        project_id: draft.project_id,
        source: "local".into(),
        source_link: None,
        provider_link: None,
        recurrence_rule: None,
        sync_status: "pending".into(),
        conflict_message: None,
        created_at_epoch_seconds: now,
        updated_at_epoch_seconds: now,
    };
    validate_planner_item(&candidate)?;
    let provider = google_write_provider(database, &kind)?;
    let (mut item, provider_etag, provider_hash) = if kind == "task" {
        let list = provider.task_lists()?.into_iter().next().ok_or_else(|| {
            AppError::new(
                "google.task_list_missing",
                "Create a Google Tasks list first.",
            )
        })?;
        let due = google_task_due(candidate.schedule.as_ref())?;
        let task = provider.create_task(
            &list.provider_id,
            &candidate.title,
            candidate.details.as_deref(),
            due.as_deref(),
        )?;
        let etag = task.etag.clone();
        let hash = task.payload_hash.clone();
        (planner_item_from_google_task(&task), etag, hash)
    } else if kind == "calendar" {
        let event = provider.create_event(&google_event_payload(&candidate)?)?;
        let etag = event.etag.clone();
        let hash = event.payload_hash.clone();
        (planner_item_from_google_event(&event), etag, hash)
    } else {
        return Err(AppError::new(
            "google.kind_unsupported",
            "Only tasks and calendar events can be added to Google.",
        ));
    };
    item.project_id = candidate.project_id;
    item.provider_link
        .as_ref()
        .ok_or_else(|| AppError::new("google.item_invalid", "Google returned an invalid item."))?;
    planner_upsert_google_item(
        database,
        brain_workspace_id,
        item.clone(),
        provider_etag.as_deref(),
        &provider_hash,
    )?;
    Ok(item)
}

fn update_google_planner_item(
    database: &Database,
    brain_workspace_id: &str,
    candidate: &PlannerItemRecord,
) -> AppResult<PlannerItemRecord> {
    let provider = google_write_provider(database, &candidate.kind)?;
    let object_id = candidate
        .provider_link
        .as_ref()
        .filter(|link| link.provider == "google")
        .map(|link| link.object_id.as_str())
        .ok_or_else(|| AppError::new("google.item_invalid", "The Google item link is invalid."))?;
    let (mut item, provider_etag, provider_hash) =
        if let Some(value) = object_id.strip_prefix("tasks:") {
            let (task_list_id, task_id) = value.split_once(':').ok_or_else(|| {
                AppError::new("google.item_invalid", "The Google task link is invalid.")
            })?;
            let due = google_task_due(candidate.schedule.as_ref())?;
            let status = if candidate.status == "completed" {
                "completed"
            } else {
                "needsAction"
            };
            let task = provider.update_task(
                task_list_id,
                task_id,
                &candidate.title,
                candidate.details.as_deref(),
                due.as_deref(),
                status,
            )?;
            let etag = task.etag.clone();
            let hash = task.payload_hash.clone();
            (planner_item_from_google_task(&task), etag, hash)
        } else if let Some(event_id) = object_id.strip_prefix("calendar:primary:") {
            let event = provider.update_event(event_id, &google_event_payload(candidate)?)?;
            let etag = event.etag.clone();
            let hash = event.payload_hash.clone();
            (planner_item_from_google_event(&event), etag, hash)
        } else {
            return Err(AppError::new(
                "google.item_invalid",
                "The Google item link is invalid.",
            ));
        };
    item.project_id.clone_from(&candidate.project_id);
    planner_upsert_google_item(
        database,
        brain_workspace_id,
        item.clone(),
        provider_etag.as_deref(),
        &provider_hash,
    )?;
    Ok(item)
}

fn delete_google_planner_item(database: &Database, item: &PlannerItemRecord) -> AppResult<()> {
    let provider = google_write_provider(database, &item.kind)?;
    let object_id = item
        .provider_link
        .as_ref()
        .filter(|link| link.provider == "google")
        .map(|link| link.object_id.as_str())
        .ok_or_else(|| AppError::new("google.item_invalid", "The Google item link is invalid."))?;
    if let Some(value) = object_id.strip_prefix("tasks:") {
        let (task_list_id, task_id) = value.split_once(':').ok_or_else(|| {
            AppError::new("google.item_invalid", "The Google task link is invalid.")
        })?;
        provider.delete_task(task_list_id, task_id)
    } else if let Some(event_id) = object_id.strip_prefix("calendar:primary:") {
        provider.delete_event(event_id)
    } else {
        Err(AppError::new(
            "google.item_invalid",
            "The Google item link is invalid.",
        ))
    }
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererDiagnostic {
    pub source: String,
    pub message: String,
    pub stack: Option<String>,
}

fn sanitize_diagnostic(value: &str, max_chars: usize) -> String {
    let bounded = value.chars().take(max_chars).collect::<String>();
    redact_text(&bounded).chars().take(max_chars).collect()
}

fn non_empty_diagnostic(value: String, fallback: &str) -> String {
    if value.is_empty() {
        fallback.to_owned()
    } else {
        value
    }
}

#[tauri::command]
pub fn system_log(diagnostic: RendererDiagnostic) -> CommandResult<()> {
    let correlation_id = correlation_id();
    let source = non_empty_diagnostic(
        sanitize_diagnostic(&diagnostic.source, MAX_DIAGNOSTIC_SOURCE_CHARS),
        "unknown",
    );
    let message = non_empty_diagnostic(
        sanitize_diagnostic(&diagnostic.message, MAX_DIAGNOSTIC_TEXT_CHARS),
        "Unknown renderer error.",
    );
    let stack = diagnostic
        .stack
        .as_deref()
        .map(|value| sanitize_diagnostic(value, MAX_DIAGNOSTIC_TEXT_CHARS));

    tracing::error!(
        target: "second_brain_os::renderer",
        correlation_id = %correlation_id,
        source = %source,
        error_message = %message,
        stack = ?stack,
        "renderer diagnostic"
    );

    CommandResult::from_result(Ok(()), correlation_id)
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
pub fn integration_settings_get() -> CommandResult<IntegrationSettings> {
    let result = database().and_then(|database| load_integration_settings(&database));
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn integration_settings_save(
    update: IntegrationSettingsUpdate,
) -> CommandResult<IntegrationSettings> {
    let result = database().and_then(|database| save_integration_settings(&database, update));
    CommandResult::from_result(result, correlation_id())
}

fn google_operation_busy() -> AppError {
    AppError::new(
        "google.operation_in_progress",
        "Another Google connection or synchronization is already in progress.",
    )
    .retryable(true)
}

#[tauri::command]
pub fn google_connection_status_get(
    runtime: State<'_, AppRuntime>,
) -> CommandResult<GoogleConnectionStatus> {
    let result = runtime
        .database
        .as_ref()
        .ok_or_else(|| {
            AppError::new(
                "google.storage_unavailable",
                "Google connection storage is unavailable. Restart the application and try again.",
            )
        })
        .and_then(|database| {
            google_connection_status(
                database,
                runtime.google_operation_active.load(Ordering::Acquire),
            )
        });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub async fn google_connect(
    brain_workspace_id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<CommandResult<GoogleSyncSummary>, ()> {
    let command_correlation = correlation_id();
    let initial = (|| {
        ensure_planner_brain(&runtime, &brain_workspace_id, true)?;
        let database = runtime.database.as_ref().cloned().ok_or_else(|| {
            AppError::new(
                "google.storage_unavailable",
                "Google connection storage is unavailable. Restart the application and try again.",
            )
        })?;
        runtime
            .google_operation_active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| google_operation_busy())?;
        Ok(database)
    })();
    let database = match initial {
        Ok(database) => database,
        Err(error) => return Ok(CommandResult::from_result(Err(error), command_correlation)),
    };
    let workspace_id = brain_workspace_id;
    let worker_database = database.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let settings = load_integration_settings(&worker_database)?.google;
        let client_id = google_client_id(&settings)?;
        let client_secret = google_client_secret(client_id)?;
        let authorization = authorize_google(client_id, &client_secret, google_access(&settings))?;
        store_refresh_token(&authorization.refresh_token)?;
        upsert_google_account(&worker_database, &settings)?;
        sync_google(&worker_database, &workspace_id)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "google.operation_failed",
            "The Google connection stopped unexpectedly. Try again.",
        )
    })
    .and_then(|result| result);
    runtime
        .google_operation_active
        .store(false, Ordering::Release);
    Ok(CommandResult::from_result(result, command_correlation))
}

#[tauri::command]
pub async fn google_sync(
    brain_workspace_id: String,
    runtime: State<'_, AppRuntime>,
) -> Result<CommandResult<GoogleSyncSummary>, ()> {
    let command_correlation = correlation_id();
    let initial = (|| {
        ensure_planner_brain(&runtime, &brain_workspace_id, true)?;
        let database = runtime.database.as_ref().cloned().ok_or_else(|| {
            AppError::new(
                "google.storage_unavailable",
                "Google sync storage is unavailable. Restart the application and try again.",
            )
        })?;
        runtime
            .google_operation_active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| google_operation_busy())?;
        Ok(database)
    })();
    let database = match initial {
        Ok(database) => database,
        Err(error) => return Ok(CommandResult::from_result(Err(error), command_correlation)),
    };
    let result =
        tauri::async_runtime::spawn_blocking(move || sync_google(&database, &brain_workspace_id))
            .await
            .map_err(|_| {
                AppError::new(
                    "google.sync_failed",
                    "Google sync stopped unexpectedly. Try again.",
                )
            })
            .and_then(|result| result);
    runtime
        .google_operation_active
        .store(false, Ordering::Release);
    Ok(CommandResult::from_result(result, command_correlation))
}

#[tauri::command]
pub async fn google_disconnect(
    runtime: State<'_, AppRuntime>,
) -> Result<CommandResult<GoogleConnectionStatus>, ()> {
    let command_correlation = correlation_id();
    let initial = (|| {
        let database = runtime.database.as_ref().cloned().ok_or_else(|| {
            AppError::new(
                "google.storage_unavailable",
                "Google connection storage is unavailable. Restart the application and try again.",
            )
        })?;
        runtime
            .google_operation_active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| google_operation_busy())?;
        Ok(database)
    })();
    let database = match initial {
        Ok(database) => database,
        Err(error) => return Ok(CommandResult::from_result(Err(error), command_correlation)),
    };
    let worker_database = database.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let settings = load_integration_settings(&worker_database)?.google;
        let token = load_refresh_token()?;
        let remote_revoked = match (settings.oauth_client_id.as_deref(), token.as_deref()) {
            (Some(_client_id), Some(refresh_token)) => revoke_google(refresh_token).is_ok(),
            _ => true,
        };
        delete_refresh_token()?;
        mark_google_disconnected(&worker_database)?;
        let mut status = google_connection_status(&worker_database, false)?;
        if !remote_revoked {
            status.message = "Disconnected locally. Google could not be reached to revoke the grant; you can also remove Second Brain OS from your Google Account.".into();
        }
        Ok(status)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "google.disconnect_failed",
            "Google disconnect stopped unexpectedly. Try again.",
        )
    })
    .and_then(|result| result);
    runtime
        .google_operation_active
        .store(false, Ordering::Release);
    Ok(CommandResult::from_result(result, command_correlation))
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

fn runtime_agents(runtime: &AppRuntime) -> AppResult<MutexGuard<'_, CodexAppServerRuntime>> {
    runtime.agents.lock().map_err(|_| {
        AppError::new(
            "agent.runtime_locked",
            "The managed agent runtime is unavailable.",
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

fn project_catalog(
    runtime: &AppRuntime,
    brain_workspace_id: &str,
    write: bool,
) -> AppResult<ProjectCatalog> {
    let record = {
        let registry = runtime_workspaces(runtime)?;
        registry
            .get(&WorkspaceId::from(brain_workspace_id))
            .map_err(|error| app_error("project.brain_unavailable", error))?
            .clone()
    };
    if record.kind != WorkspaceKind::Brain {
        return Err(AppError::new(
            "project.brain_required",
            "Projects must be stored in a Brain workspace.",
        ));
    }
    let capabilities = record.trust_level.capabilities();
    if !capabilities.read || (write && !capabilities.write) {
        return Err(AppError::new(
            "project.brain_access_denied",
            if write {
                "The Brain workspace is not writable."
            } else {
                "The Brain workspace is not readable."
            },
        ));
    }
    let root = record.root_path().ok_or_else(|| {
        AppError::new(
            "project.brain_unavailable",
            "The Brain workspace has no available root.",
        )
    })?;
    ProjectCatalog::new(record.id.as_str(), root)
        .map_err(|error| app_error("project.catalog_unavailable", error))
}

fn consume_root_selection(runtime: &AppRuntime, grant_id: &str) -> AppResult<RootSelectionGrant> {
    let mut grants = runtime.root_selection_grants.lock().map_err(|_| {
        AppError::new(
            "runtime.unavailable",
            "Folder selection is temporarily unavailable. Please try again.",
        )
        .retryable(true)
    })?;
    grants.retain(|_, grant| grant.expires_at > Instant::now());
    grants.remove(grant_id).ok_or_else(|| {
        AppError::new(
            "workspace.root_grant_invalid",
            "This folder selection expired or was already used. Choose the folder again.",
        )
        .retryable(true)
    })
}

fn resolve_project_location(
    runtime: &AppRuntime,
    project_name: &str,
    input: ProjectLocationInput,
) -> AppResult<Option<ProjectLocation>> {
    match input {
        ProjectLocationInput::None => Ok(None),
        ProjectLocationInput::ExistingWorkspace { workspace_id } => {
            let record = {
                let registry = runtime_workspaces(runtime)?;
                registry
                    .get(&WorkspaceId::from(workspace_id.as_str()))
                    .map_err(|error| app_error("project.location_unavailable", error))?
                    .clone()
            };
            if record.kind == WorkspaceKind::Collection || record.root_path().is_none() {
                return Err(AppError::new(
                    "project.location_invalid",
                    "Choose a workspace with an available folder.",
                ));
            }
            Ok(Some(ProjectLocation {
                workspace_id: record.id.as_str().to_owned(),
                display_path: record.display_root.unwrap_or_default(),
            }))
        }
        ProjectLocationInput::RootSelection {
            grant_id,
            trust_level,
        } => {
            let grant = consume_root_selection(runtime, &grant_id)?;
            let mut registry = runtime_workspaces(runtime)?;
            let record = if let Some(existing) = registry
                .find_by_canonical_root(&grant.canonical_path)
                .cloned()
            {
                existing
            } else {
                let record = registry
                    .register(RegisterWorkspace {
                        id: None,
                        name: project_name.to_owned(),
                        kind: WorkspaceKind::Project,
                        display_root: Some(grant.canonical_path),
                        trust_level: Some(trust_level),
                    })
                    .map_err(|error| app_error("project.location_registration_failed", error))?;
                persist_workspace_registry(&registry)?;
                record
            };
            Ok(Some(ProjectLocation {
                workspace_id: record.id.as_str().to_owned(),
                display_path: grant.display_path,
            }))
        }
    }
}

fn publish_audit_event(
    runtime: &AppRuntime,
    kind: EventKind,
    payload: serde_json::Value,
    workspace_id: Option<String>,
    correlation: Option<String>,
) -> AppResult<()> {
    let event = EventEnvelope::new(
        kind,
        payload,
        workspace_id,
        correlation,
        Actor {
            kind: "user".into(),
            id: Some("desktop".into()),
        },
        1,
        RedactionClass::Internal,
        true,
    )?;
    runtime.events.publish(event)?;
    Ok(())
}

fn activity_category(event_type: &str) -> &'static str {
    if event_type.starts_with("agent.") {
        "runs"
    } else if event_type.starts_with("file.") || event_type.starts_with("git.") {
        "changes"
    } else if event_type.contains("approval")
        || event_type.contains("conflict")
        || event_type.ends_with("failed")
    {
        "attention"
    } else {
        "history"
    }
}

fn list_activity(database: &Database, request: &ActivityListRequest) -> AppResult<ActivityPage> {
    let limit = request.limit.unwrap_or(50).clamp(1, 100);
    let category = request.category.as_deref().unwrap_or("all");
    if !matches!(
        category,
        "all" | "attention" | "runs" | "changes" | "history"
    ) {
        return Err(AppError::new(
            "activity.category_invalid",
            "Choose a supported Activity category.",
        ));
    }
    let project_path = request
        .project_id
        .as_ref()
        .map(|_| "$.payload.projectId".to_owned());
    let mut items = database
        .with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT event_id, event_type, occurred_at, workspace_id,
                    correlation_id, actor_type, payload_json
             FROM audit_events
             WHERE (?1 IS NULL OR workspace_id = ?1)
               AND (?2 IS NULL OR json_extract(payload_json, ?3) = ?2)
               AND (
                 ?4 = 'all'
                 OR (?4 = 'runs' AND event_type LIKE 'agent.%')
                 OR (?4 = 'changes' AND (event_type LIKE 'file.%' OR event_type LIKE 'git.%'))
                 OR (?4 = 'attention' AND (
                   event_type LIKE '%.approval.%'
                   OR event_type LIKE '%.conflict.%'
                   OR event_type LIKE '%.failed'
                 ))
                 OR (?4 = 'history' AND event_type NOT LIKE 'agent.%')
               )
               AND (
                 ?5 IS NULL
                 OR (occurred_at, event_id) < (
                   SELECT occurred_at, event_id FROM audit_events WHERE event_id = ?5
                 )
               )
             ORDER BY occurred_at DESC, event_id DESC
             LIMIT ?6",
            )?;
            let rows = statement.query_map(
                params![
                    request.workspace_id,
                    request.project_id,
                    project_path,
                    category,
                    request.cursor,
                    i64::try_from(limit + 1).unwrap_or(101),
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                },
            )?;
            rows.collect::<Result<Vec<_>, _>>()
        })?
        .into_iter()
        .map(
            |(
                id,
                event_type,
                timestamp,
                workspace_id,
                correlation_id,
                actor_type,
                payload_json,
            )| {
                let envelope: serde_json::Value =
                    serde_json::from_str(&payload_json).map_err(|error| {
                        AppError::new("activity.payload_invalid", "An Activity record is invalid.")
                            .with_details(serde_json::json!({ "reason": error.to_string() }))
                    })?;
                let payload = envelope
                    .get("payload")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                Ok(ActivityItem {
                    id,
                    category: activity_category(&event_type).into(),
                    event_type,
                    timestamp,
                    workspace_id,
                    correlation_id,
                    actor_type,
                    payload,
                })
            },
        )
        .collect::<AppResult<Vec<_>>>()?;
    let next_cursor = (items.len() > limit)
        .then(|| items.get(limit - 1).map(|item| item.id.clone()))
        .flatten();
    items.truncate(limit);
    Ok(ActivityPage { items, next_cursor })
}

fn now_epoch_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

fn validate_planner_kind(kind: &str) -> AppResult<()> {
    if matches!(kind, "task" | "milestone" | "focus_block" | "calendar") {
        Ok(())
    } else {
        Err(AppError::new(
            "planner.kind_invalid",
            "Choose a task, milestone, focus block, or calendar item.",
        ))
    }
}

fn validate_planner_status(status: &str) -> AppResult<()> {
    if matches!(status, "open" | "in_progress" | "completed" | "archived") {
        Ok(())
    } else {
        Err(AppError::new(
            "planner.status_invalid",
            "Choose a supported planner status.",
        ))
    }
}

fn validate_planner_schedule(schedule: &PlannerScheduleRecord) -> AppResult<()> {
    match schedule {
        PlannerScheduleRecord::DateOnly { date } | PlannerScheduleRecord::AllDay { date } => {
            DateOnly::new(date)
                .map(|_| ())
                .map_err(|error| app_error("planner.date_invalid", error))
        }
        PlannerScheduleRecord::Exact {
            start_epoch_seconds,
            end_epoch_seconds,
            timezone,
        } => {
            if timezone.trim().is_empty()
                || end_epoch_seconds.is_some_and(|end| end < *start_epoch_seconds)
            {
                Err(AppError::new(
                    "planner.schedule_invalid",
                    "Check the planner date, time, and timezone.",
                ))
            } else {
                Ok(())
            }
        }
    }
}

fn validate_planner_item(item: &PlannerItemRecord) -> AppResult<()> {
    let title_length = item.title.trim().chars().count();
    if title_length == 0 || title_length > 240 {
        return Err(AppError::new(
            "planner.title_invalid",
            "Enter a title between 1 and 240 characters.",
        ));
    }
    if item
        .details
        .as_ref()
        .is_some_and(|value| value.chars().count() > 20_000)
    {
        return Err(AppError::new(
            "planner.details_too_long",
            "Planner details must be 20,000 characters or fewer.",
        ));
    }
    if item
        .location
        .as_ref()
        .is_some_and(|value| value.chars().count() > 500)
    {
        return Err(AppError::new(
            "planner.location_too_long",
            "Event locations must be 500 characters or fewer.",
        ));
    }
    validate_planner_kind(&item.kind)?;
    validate_planner_status(&item.status)?;
    if let Some(schedule) = item.schedule.as_ref() {
        validate_planner_schedule(schedule)?;
    }
    Ok(())
}

fn ensure_planner_brain(runtime: &AppRuntime, workspace_id: &str, write: bool) -> AppResult<()> {
    let record = registered_workspace(runtime, workspace_id)?;
    if record.kind != WorkspaceKind::Brain {
        return Err(AppError::new(
            "planner.brain_required",
            "Planner items must belong to the Brain workspace.",
        ));
    }
    let capabilities = record.trust_level.capabilities();
    if !capabilities.read || (write && !capabilities.write) {
        return Err(AppError::new(
            "planner.access_denied",
            "This Brain does not grant the access required for that planner action.",
        ));
    }
    Ok(())
}

fn ensure_planner_project(
    runtime: &AppRuntime,
    brain_workspace_id: &str,
    project_id: Option<&str>,
) -> AppResult<()> {
    let Some(project_id) = project_id else {
        return Ok(());
    };
    project_catalog(runtime, brain_workspace_id, false)?
        .get(&ProjectId::from(project_id))
        .map(|_| ())
        .map_err(|error| app_error("planner.project_unavailable", error))
}

fn planner_schedule_columns(
    schedule: Option<&PlannerScheduleRecord>,
) -> (&'static str, Option<String>, Option<String>) {
    match schedule {
        None => ("none", None, None),
        Some(PlannerScheduleRecord::DateOnly { date }) => ("date_only", Some(date.clone()), None),
        Some(PlannerScheduleRecord::AllDay { date }) => ("all_day", Some(date.clone()), None),
        Some(PlannerScheduleRecord::Exact {
            start_epoch_seconds,
            end_epoch_seconds,
            timezone,
        }) => (
            "exact",
            Some(
                serde_json::json!({
                    "startEpochSeconds": start_epoch_seconds,
                    "endEpochSeconds": end_epoch_seconds,
                })
                .to_string(),
            ),
            Some(timezone.clone()),
        ),
    }
}

fn planner_store_item(
    database: &Database,
    brain_workspace_id: &str,
    item: &PlannerItemRecord,
    insert: bool,
) -> AppResult<()> {
    let value = serde_json::to_string(&PlannerLocalSnapshot {
        schema_version: 1,
        item: item.clone(),
    })
    .map_err(|error| {
        AppError::new(
            "planner.serialize_failed",
            "The planner item could not be saved.",
        )
        .with_details(serde_json::json!({ "reason": error.to_string() }))
    })?;
    let (schedule_kind, scheduled_value, timezone) =
        planner_schedule_columns(item.schedule.as_ref());
    // This column references a knowledge document identity, not a display path.
    // Until planner ingestion resolves that identity, the source link stays in
    // the versioned local snapshot and the foreign key remains empty.
    let source_document_id: Option<&str> = None;
    let source_task_id = item
        .source_link
        .as_ref()
        .and_then(|link| link.explicit_task_id.as_deref());
    let source_start_line = item
        .source_link
        .as_ref()
        .and_then(|link| link.start_line)
        .map(i64::from);
    let source_end_line = item
        .source_link
        .as_ref()
        .and_then(|link| link.end_line)
        .map(i64::from);
    let result = database.with_connection(|connection| {
        if insert {
            connection.execute(
                "INSERT INTO planner_items (
                    item_id, workspace_id, kind, provider, provider_item_id, project_id,
                    title, status, schedule_kind, scheduled_value, timezone,
                    source_document_id, source_task_id, source_start_line, source_end_line,
                    local_enrichment_json, provider_fields_json, provider_etag, sync_status,
                    conflict_status, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, 'local', NULL, ?4, ?5, ?6, ?7, ?8, ?9,
                    ?10, ?11, ?12, ?13, ?14, '{}', NULL, ?15, 'none', ?16, ?17
                 )",
                params![
                    item.id,
                    brain_workspace_id,
                    item.kind,
                    item.project_id,
                    item.title,
                    item.status,
                    schedule_kind,
                    scheduled_value,
                    timezone,
                    source_document_id,
                    source_task_id,
                    source_start_line,
                    source_end_line,
                    value,
                    item.sync_status,
                    item.created_at_epoch_seconds.to_string(),
                    item.updated_at_epoch_seconds.to_string(),
                ],
            )?;
        } else {
            connection.execute(
                "UPDATE planner_items SET
                    project_id = ?3, title = ?4, status = ?5, schedule_kind = ?6,
                    scheduled_value = ?7, timezone = ?8, source_document_id = ?9,
                    source_task_id = ?10, source_start_line = ?11, source_end_line = ?12,
                    local_enrichment_json = ?13, sync_status = ?14, updated_at = ?15
                 WHERE item_id = ?1 AND workspace_id = ?2 AND provider = 'local'",
                params![
                    item.id,
                    brain_workspace_id,
                    item.project_id,
                    item.title,
                    item.status,
                    schedule_kind,
                    scheduled_value,
                    timezone,
                    source_document_id,
                    source_task_id,
                    source_start_line,
                    source_end_line,
                    value,
                    item.sync_status,
                    item.updated_at_epoch_seconds.to_string(),
                ],
            )?;
        }
        Ok(())
    });
    result.map_err(|error| {
        if error.to_string().contains("planner_source_task") {
            AppError::new(
                "planner.source_duplicate",
                "That Markdown task is already linked to another planner item.",
            )
        } else {
            error
        }
    })
}

fn planner_list_items(
    database: &Database,
    request: &PlannerListRequest,
) -> AppResult<Vec<PlannerItemRecord>> {
    let values = database.with_connection(|connection| {
        let range = request.range.as_ref();
        let mut statement = connection.prepare(
            "SELECT local_enrichment_json FROM planner_items
             WHERE workspace_id = ?1 AND (?2 IS NULL OR project_id = ?2)
               AND (
                 kind = 'task' OR ?3 IS NULL OR
                 (schedule_kind IN ('date_only', 'all_day')
                   AND scheduled_value >= ?3 AND scheduled_value < ?4) OR
                 (schedule_kind = 'exact'
                   AND CAST(json_extract(scheduled_value, '$.startEpochSeconds') AS INTEGER) >= ?5
                   AND CAST(json_extract(scheduled_value, '$.startEpochSeconds') AS INTEGER) < ?6)
               )
             ORDER BY updated_at DESC, item_id ASC",
        )?;
        let rows = statement.query_map(
            params![
                request.brain_workspace_id,
                request.project_id,
                range.map(|value| value.start_date.as_str()),
                range.map(|value| value.end_date.as_str()),
                range.map(|value| value.start_epoch_seconds),
                range.map(|value| value.end_epoch_seconds),
            ],
            |row| row.get::<_, String>(0),
        )?;
        rows.collect::<Result<Vec<_>, _>>()
    })?;
    values
        .into_iter()
        .map(|value| {
            serde_json::from_str::<PlannerLocalSnapshot>(&value)
                .map(|snapshot| snapshot.item)
                .map_err(|error| {
                    AppError::new(
                        "planner.item_invalid",
                        "A stored planner item could not be read.",
                    )
                    .with_details(serde_json::json!({ "reason": error.to_string() }))
                })
        })
        .collect()
}

fn planner_get_item(
    database: &Database,
    brain_workspace_id: &str,
    item_id: &str,
) -> AppResult<PlannerItemRecord> {
    let value = database.with_connection(|connection| {
        connection
            .query_row(
                "SELECT local_enrichment_json FROM planner_items
                 WHERE item_id = ?1 AND workspace_id = ?2",
                params![item_id, brain_workspace_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
    })?;
    let value = value.ok_or_else(|| {
        AppError::new(
            "planner.item_missing",
            "That planner item no longer exists.",
        )
    })?;
    serde_json::from_str::<PlannerLocalSnapshot>(&value)
        .map(|snapshot| snapshot.item)
        .map_err(|error| {
            AppError::new(
                "planner.item_invalid",
                "The stored planner item could not be read.",
            )
            .with_details(serde_json::json!({ "reason": error.to_string() }))
        })
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
pub fn workspace_select_root(
    app: AppHandle,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<Option<RootSelection>> {
    let result = (|| {
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("Choose a Project folder")
            .set_can_create_directories(true)
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let display_path = selected
            .into_path()
            .map_err(|error| app_error("workspace.folder_selection_invalid", error))?;
        let canonical_path = std::fs::canonicalize(&display_path)
            .map_err(|error| app_error("workspace.folder_selection_invalid", error))?;
        if !canonical_path.is_dir() {
            return Err(AppError::new(
                "workspace.folder_selection_invalid",
                "The selected location is not a folder.",
            ));
        }
        let grant_id = format!("root_grant_{}", ulid::Ulid::new());
        let display_path = display_path.to_string_lossy().into_owned();
        let suggested_name = canonical_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Project")
            .to_owned();
        let mut grants = runtime.root_selection_grants.lock().map_err(|_| {
            AppError::new(
                "runtime.unavailable",
                "Folder selection is temporarily unavailable. Please try again.",
            )
            .retryable(true)
        })?;
        grants.retain(|_, grant| grant.expires_at > Instant::now());
        grants.insert(
            grant_id.clone(),
            RootSelectionGrant {
                canonical_path,
                display_path: display_path.clone(),
                expires_at: Instant::now() + ROOT_GRANT_LIFETIME,
            },
        );
        Ok(Some(RootSelection {
            grant_id,
            display_path,
            suggested_name,
        }))
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn workspace_register(
    registration: WorkspaceRegistration,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<WorkspaceSummary> {
    let result = (|| {
        let display_root = if registration.kind == WorkspaceKind::Collection {
            None
        } else {
            let grant_id = registration.root_grant_id.as_deref().ok_or_else(|| {
                AppError::new(
                    "workspace.root_grant_required",
                    "Choose the workspace folder again before registering it.",
                )
            })?;
            let grant = consume_root_selection(&runtime, grant_id)?;
            Some(grant.canonical_path)
        };
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
pub fn project_list(
    brain_workspace_id: String,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<Vec<ProjectRecord>> {
    let result = project_catalog(&runtime, &brain_workspace_id, false).and_then(|catalog| {
        catalog
            .list()
            .map_err(|error| app_error("project.list_failed", error))
    });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn project_get(
    request: ProjectReadRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<ProjectRecord> {
    let result =
        project_catalog(&runtime, &request.brain_workspace_id, false).and_then(|catalog| {
            catalog
                .get(&ProjectId::from(request.project_id.as_str()))
                .map_err(|error| app_error("project.read_failed", error))
        });
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn project_create(
    request: ProjectCreateRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<ProjectRecord> {
    let command_correlation = correlation_id();
    let result = (|| {
        let location = resolve_project_location(&runtime, &request.name, request.location)?;
        let catalog = project_catalog(&runtime, &request.brain_workspace_id, true)?;
        let project = catalog
            .create(CreateProject {
                name: request.name,
                outcome: request.outcome,
                template_id: request.template_id,
                instructions: request.instructions,
                tags: request.tags,
                location,
            })
            .map_err(|error| app_error("project.create_failed", error))?;
        publish_audit_event(
            &runtime,
            EventKind::Custom("project.created".into()),
            serde_json::json!({
                "projectId": project.id.as_str(),
                "changedFields": ["name", "outcome", "status", "progressPercent", "location"],
                "linkedWorkspaceId": project.location.as_ref().map(|location| &location.workspace_id),
            }),
            Some(request.brain_workspace_id),
            Some(command_correlation.clone()),
        )?;
        Ok(project)
    })();
    CommandResult::from_result(result, command_correlation)
}

#[tauri::command]
pub fn project_update(
    request: ProjectUpdateRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<ProjectRecord> {
    let command_correlation = correlation_id();
    let changed_fields = project_patch_fields(&request.patch);
    let result = project_catalog(&runtime, &request.brain_workspace_id, true).and_then(|catalog| {
        let project = catalog
            .update(&ProjectId::from(request.project_id.as_str()), request.patch)
            .map_err(|error| app_error("project.update_failed", error))?;
        publish_audit_event(
            &runtime,
            EventKind::Custom("project.updated".into()),
            serde_json::json!({
                "projectId": project.id.as_str(),
                "changedFields": changed_fields,
                "linkedWorkspaceId": project.location.as_ref().map(|location| &location.workspace_id),
            }),
            Some(request.brain_workspace_id.clone()),
            Some(command_correlation.clone()),
        )?;
        Ok(project)
    });
    CommandResult::from_result(result, command_correlation)
}

#[tauri::command]
pub fn project_set_status(
    request: ProjectStatusRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<ProjectRecord> {
    let command_correlation = correlation_id();
    let result = project_catalog(&runtime, &request.brain_workspace_id, true).and_then(|catalog| {
        let project = catalog
            .update(
                &ProjectId::from(request.project_id.as_str()),
                ProjectPatch {
                    status: Some(request.status),
                    ..ProjectPatch::default()
                },
            )
            .map_err(|error| app_error("project.status_failed", error))?;
        publish_audit_event(
            &runtime,
            EventKind::Custom("project.status_changed".into()),
            serde_json::json!({
                "projectId": project.id.as_str(),
                "status": project.status,
                "changedFields": ["status"],
            }),
            Some(request.brain_workspace_id.clone()),
            Some(command_correlation.clone()),
        )?;
        Ok(project)
    });
    CommandResult::from_result(result, command_correlation)
}

fn project_patch_fields(patch: &ProjectPatch) -> Vec<&'static str> {
    [
        patch.name.as_ref().map(|_| "name"),
        patch.outcome.as_ref().map(|_| "outcome"),
        patch.template_id.as_ref().map(|_| "templateId"),
        patch.instructions.as_ref().map(|_| "instructions"),
        patch.status.as_ref().map(|_| "status"),
        patch.progress_percent.as_ref().map(|_| "progressPercent"),
        patch.next_milestone.as_ref().map(|_| "nextMilestone"),
        patch.blocker.as_ref().map(|_| "blocker"),
        patch.tags.as_ref().map(|_| "tags"),
        patch.location.as_ref().map(|_| "location"),
    ]
    .into_iter()
    .flatten()
    .collect()
}

#[tauri::command]
pub fn activity_list(
    request: ActivityListRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<ActivityPage> {
    let result = runtime
        .database
        .as_ref()
        .ok_or_else(|| {
            AppError::new(
                "activity.unavailable",
                "Activity storage is unavailable. Restart the application and try again.",
            )
            .retryable(true)
        })
        .and_then(|database| list_activity(database, &request));
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn planner_list(
    request: PlannerListRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<Vec<PlannerItemRecord>> {
    let result = (|| {
        ensure_planner_brain(&runtime, &request.brain_workspace_id, false)?;
        if let Some(range) = &request.range {
            DateOnly::try_from(range.start_date.as_str())
                .map_err(|error| app_error("planner.date_invalid", error))?;
            DateOnly::try_from(range.end_date.as_str())
                .map_err(|error| app_error("planner.date_invalid", error))?;
            let valid_epoch_range = range
                .end_epoch_seconds
                .checked_sub(range.start_epoch_seconds)
                .is_some_and(|seconds| seconds > 0 && seconds <= 63 * 86_400);
            if range.start_date >= range.end_date || !valid_epoch_range {
                return Err(AppError::new(
                    "planner.range_invalid",
                    "Choose a calendar range of 63 days or fewer.",
                ));
            }
        }
        ensure_planner_project(
            &runtime,
            &request.brain_workspace_id,
            request.project_id.as_deref(),
        )?;
        let database = runtime.database.as_ref().ok_or_else(|| {
            AppError::new(
                "planner.unavailable",
                "Local planning storage is unavailable. Restart the application and try again.",
            )
            .retryable(true)
        })?;
        planner_list_items(database, &request)
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn planner_create(
    request: PlannerCreateRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<PlannerItemRecord> {
    let command_correlation = correlation_id();
    let result = (|| {
        ensure_planner_brain(&runtime, &request.brain_workspace_id, true)?;
        ensure_planner_project(
            &runtime,
            &request.brain_workspace_id,
            request.draft.project_id.as_deref(),
        )?;
        let database = runtime.database.as_ref().ok_or_else(|| {
            AppError::new(
                "planner.unavailable",
                "Local planning storage is unavailable. Restart the application and try again.",
            )
            .retryable(true)
        })?;
        match request.sync_target.as_deref() {
            Some("google") => {
                let item = create_google_planner_item(
                    database,
                    &request.brain_workspace_id,
                    request.draft,
                )?;
                publish_audit_event(
                    &runtime,
                    EventKind::Custom("planner.item.created".into()),
                    serde_json::json!({
                        "itemId": item.id,
                        "projectId": item.project_id,
                        "kind": item.kind,
                        "status": item.status,
                        "provider": "google",
                    }),
                    Some(request.brain_workspace_id),
                    Some(command_correlation.clone()),
                )?;
                return Ok(item);
            }
            None | Some("local") => {}
            Some(_) => {
                return Err(AppError::new(
                    "planner.sync_target_invalid",
                    "Choose Local or Google as the planner destination.",
                ));
            }
        }
        let now = now_epoch_seconds();
        let item = PlannerItemRecord {
            id: format!("planner_{}", UlidGenerator.next_id()),
            kind: request.draft.kind.unwrap_or_else(|| "task".into()),
            title: request.draft.title.trim().to_owned(),
            details: request.draft.details,
            location: request.draft.location,
            schedule: request.draft.schedule,
            status: "open".into(),
            project_id: request.draft.project_id,
            source: "local".into(),
            source_link: None,
            provider_link: None,
            recurrence_rule: None,
            sync_status: "local_only".into(),
            conflict_message: None,
            created_at_epoch_seconds: now,
            updated_at_epoch_seconds: now,
        };
        validate_planner_item(&item)?;
        planner_store_item(database, &request.brain_workspace_id, &item, true)?;
        let schedule_kind = planner_schedule_columns(item.schedule.as_ref()).0;
        publish_audit_event(
            &runtime,
            EventKind::Custom("planner.item.created".into()),
            serde_json::json!({
                "itemId": item.id,
                "projectId": item.project_id,
                "kind": item.kind,
                "status": item.status,
                "scheduleKind": schedule_kind,
            }),
            Some(request.brain_workspace_id),
            Some(command_correlation.clone()),
        )?;
        Ok(item)
    })();
    CommandResult::from_result(result, command_correlation)
}

#[tauri::command]
pub fn planner_update(
    request: PlannerUpdateRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<PlannerItemRecord> {
    let command_correlation = correlation_id();
    let result = (|| {
        ensure_planner_brain(&runtime, &request.brain_workspace_id, true)?;
        let database = runtime.database.as_ref().ok_or_else(|| {
            AppError::new(
                "planner.unavailable",
                "Local planning storage is unavailable. Restart the application and try again.",
            )
            .retryable(true)
        })?;
        let mut item = planner_get_item(database, &request.brain_workspace_id, &request.item_id)?;
        let mut changed_fields = Vec::new();
        if let Some(title) = request.patch.title {
            item.title = title.trim().to_owned();
            changed_fields.push("title");
        }
        if request.patch.clear_details.unwrap_or(false) {
            item.details = None;
            changed_fields.push("details");
        } else if let Some(details) = request.patch.details {
            item.details = Some(details);
            changed_fields.push("details");
        }
        if request.patch.clear_location.unwrap_or(false) {
            item.location = None;
            changed_fields.push("location");
        } else if let Some(location) = request.patch.location {
            item.location = Some(location.trim().to_owned());
            changed_fields.push("location");
        }
        if request.patch.clear_schedule.unwrap_or(false) {
            item.schedule = None;
            changed_fields.push("schedule");
        } else if let Some(schedule) = request.patch.schedule {
            item.schedule = Some(schedule);
            changed_fields.push("schedule");
        }
        if let Some(status) = request.patch.status {
            item.status = status;
            changed_fields.push("status");
        }
        if request.patch.clear_project.unwrap_or(false) {
            item.project_id = None;
            changed_fields.push("projectId");
        } else if let Some(project_id) = request.patch.project_id {
            item.project_id = Some(project_id);
            changed_fields.push("projectId");
        }
        ensure_planner_project(
            &runtime,
            &request.brain_workspace_id,
            item.project_id.as_deref(),
        )?;
        item.updated_at_epoch_seconds = now_epoch_seconds();
        validate_planner_item(&item)?;
        item = if item
            .provider_link
            .as_ref()
            .is_some_and(|link| link.provider == "google")
        {
            update_google_planner_item(database, &request.brain_workspace_id, &item)?
        } else {
            planner_store_item(database, &request.brain_workspace_id, &item, false)?;
            item
        };
        let schedule_kind = planner_schedule_columns(item.schedule.as_ref()).0;
        publish_audit_event(
            &runtime,
            EventKind::Custom("planner.item.updated".into()),
            serde_json::json!({
                "itemId": item.id,
                "projectId": item.project_id,
                "kind": item.kind,
                "status": item.status,
                "scheduleKind": schedule_kind,
                "changedFields": changed_fields,
            }),
            Some(request.brain_workspace_id),
            Some(command_correlation.clone()),
        )?;
        Ok(item)
    })();
    CommandResult::from_result(result, command_correlation)
}

#[tauri::command]
pub fn planner_delete(
    request: PlannerDeleteRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let command_correlation = correlation_id();
    let result = (|| {
        ensure_planner_brain(&runtime, &request.brain_workspace_id, true)?;
        let database = runtime.database.as_ref().ok_or_else(|| {
            AppError::new(
                "planner.unavailable",
                "Local planning storage is unavailable. Restart the application and try again.",
            )
            .retryable(true)
        })?;
        let item = planner_get_item(database, &request.brain_workspace_id, &request.item_id)?;
        if item
            .provider_link
            .as_ref()
            .is_some_and(|link| link.provider == "google")
        {
            delete_google_planner_item(database, &item)?;
        }
        database.with_connection(|connection| {
            connection.execute(
                "DELETE FROM planner_items WHERE item_id = ?1 AND workspace_id = ?2",
                params![request.item_id, request.brain_workspace_id],
            )?;
            Ok(())
        })?;
        publish_audit_event(
            &runtime,
            EventKind::Custom("planner.item.deleted".into()),
            serde_json::json!({
                "itemId": item.id,
                "kind": item.kind,
                "provider": item.provider_link.as_ref().map(|link| link.provider.as_str()).unwrap_or("local"),
            }),
            Some(request.brain_workspace_id),
            Some(command_correlation.clone()),
        )?;
        Ok(())
    })();
    CommandResult::from_result(result, command_correlation)
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
pub fn agent_provider_probe() -> CommandResult<ProviderProbe> {
    CommandResult::from_result(Ok(CodexAppServerRuntime::probe()), correlation_id())
}

#[tauri::command]
pub fn agent_session_start(
    request: StartManagedSession,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<AgentSessionSnapshot> {
    let command_correlation = correlation_id();
    let result = (|| {
        let workspace = registered_workspace(&runtime, &request.workspace_id)?;
        let capabilities = workspace.trust_level.capabilities();
        if !capabilities.read {
            return Err(AppError::new(
                "agent.read_denied",
                "This workspace does not permit managed agent reads.",
            ));
        }
        let root = workspace.root_path().ok_or_else(|| {
            AppError::new(
                "agent.invalid_root",
                "The managed agent requires a registered local workspace root.",
            )
        })?;
        let database = runtime.database.as_ref().ok_or_else(|| {
            AppError::new(
                "agent.storage_unavailable",
                "Managed agent storage is unavailable. Restart the application and try again.",
            )
            .retryable(true)
        })?;
        let workspace_id = request.workspace_id.clone();
        let sandbox = request.sandbox;
        let snapshot =
            runtime_agents(&runtime)?.start(database, request, root, capabilities.write)?;
        publish_audit_event(
            &runtime,
            EventKind::AgentSessionStarted,
            serde_json::json!({
                "sessionId": snapshot.id,
                "provider": "codex",
                "sandbox": sandbox,
            }),
            Some(workspace_id),
            Some(command_correlation.clone()),
        )?;
        Ok(snapshot)
    })();
    CommandResult::from_result(result, command_correlation)
}

#[tauri::command]
pub fn agent_session_list(
    workspace_id: String,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<Vec<AgentSessionSnapshot>> {
    let result = (|| {
        let workspace = registered_workspace(&runtime, &workspace_id)?;
        if !workspace.trust_level.capabilities().read {
            return Err(AppError::new(
                "agent.read_denied",
                "This workspace does not permit managed agent reads.",
            ));
        }
        let database = runtime.database.as_ref().ok_or_else(|| {
            AppError::new(
                "agent.storage_unavailable",
                "Managed agent storage is unavailable. Restart the application and try again.",
            )
            .retryable(true)
        })?;
        runtime_agents(&runtime)?.pump_all(database)?;
        list_persisted_sessions(database, &workspace_id)
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn agent_session_message(
    request: ManagedSessionMessageRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let result = (|| {
        registered_workspace(&runtime, &request.workspace_id)?;
        let database = runtime.database.as_ref().ok_or_else(|| {
            AppError::new(
                "agent.storage_unavailable",
                "Managed agent storage is unavailable. Restart the application and try again.",
            )
            .retryable(true)
        })?;
        runtime_agents(&runtime)?.send_message(database, &request)
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn agent_session_cancel(
    request: ManagedSessionRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let result = (|| {
        registered_workspace(&runtime, &request.workspace_id)?;
        let database = runtime.database.as_ref().ok_or_else(|| {
            AppError::new(
                "agent.storage_unavailable",
                "Managed agent storage is unavailable. Restart the application and try again.",
            )
            .retryable(true)
        })?;
        runtime_agents(&runtime)?.cancel(database, &request)
    })();
    CommandResult::from_result(result, correlation_id())
}

#[tauri::command]
pub fn agent_approval_decide(
    request: ManagedApprovalDecisionRequest,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let result = (|| {
        registered_workspace(&runtime, &request.workspace_id)?;
        let database = runtime.database.as_ref().ok_or_else(|| {
            AppError::new(
                "agent.storage_unavailable",
                "Managed agent storage is unavailable. Restart the application and try again.",
            )
            .retryable(true)
        })?;
        runtime_agents(&runtime)?.decide_approval(database, &request)
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
    let command_correlation = request.correlation_id.clone();
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
        let workspace_id = request.path.workspace_id.clone();
        let relative_path = request.path.relative_path.clone();
        let created = request.base_hash.is_none();
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
        publish_audit_event(
            &runtime,
            if created {
                EventKind::FileCreated
            } else {
                EventKind::FileModified
            },
            serde_json::json!({
                "resourceKind": "file",
                "resourceId": relative_path,
                "path": relative_path,
                "operationId": mutation.operation_id.clone(),
                "revisionId": mutation.revision_id.clone(),
                "contentHash": content_hash.clone(),
                "sizeBytes": mutation.size_bytes,
            }),
            Some(workspace_id),
            Some(command_correlation.clone()),
        )?;
        Ok(FileWriteResult {
            operation_id: mutation.operation_id,
            revision_id: mutation.revision_id,
            content_hash,
            size_bytes: mutation.size_bytes,
            merge_notice: mutation.merge_notice,
        })
    })();
    CommandResult::from_result(result, command_correlation)
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
    let command_correlation = correlation_id();
    let result = git_mutation(
        &runtime,
        &workspace_id,
        &paths,
        "staged",
        &command_correlation,
        |git, values| git.stage(values),
    );
    CommandResult::from_result(result, command_correlation)
}

#[tauri::command]
pub fn git_unstage(
    workspace_id: String,
    paths: Vec<String>,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let command_correlation = correlation_id();
    let result = git_mutation(
        &runtime,
        &workspace_id,
        &paths,
        "unstaged",
        &command_correlation,
        |git, values| git.unstage(values),
    );
    CommandResult::from_result(result, command_correlation)
}

#[tauri::command]
pub fn git_discard(
    workspace_id: String,
    paths: Vec<String>,
    confirmed: bool,
    runtime: State<'_, AppRuntime>,
) -> CommandResult<()> {
    let command_correlation = correlation_id();
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
        publish_audit_event(
            &runtime,
            EventKind::Custom("git.discarded".into()),
            serde_json::json!({ "operation": "discarded", "paths": paths }),
            Some(workspace_id.clone()),
            Some(command_correlation.clone()),
        )?;
        Ok(())
    })();
    CommandResult::from_result(result, command_correlation)
}

fn git_mutation(
    runtime: &AppRuntime,
    workspace_id: &str,
    paths: &[String],
    event_operation: &str,
    command_correlation: &str,
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
    publish_audit_event(
        runtime,
        EventKind::Custom(format!("git.{event_operation}")),
        serde_json::json!({ "operation": event_operation, "paths": paths }),
        Some(workspace_id.to_owned()),
        Some(command_correlation.to_owned()),
    )?;
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
                preset.unwrap_or_else(PresetId::default_for_current_platform),
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
        ActivityListRequest, AppRuntime, CodexAppServerRuntime, CodexIntegrationSettings,
        GoogleConsentMode, GoogleIntegrationSettingsUpdate, INTEGRATION_SETTINGS_KEY,
        IntegrationSettingsUpdate, MAX_ATTACHMENT_BYTES, PlannerItemRecord, PlannerListRangeRecord,
        PlannerListRequest, PlannerScheduleRecord, RootSelectionGrant, SHELL_LAYOUT_KEY,
        ShellLayout, attachment_media_type, consume_root_selection, decode_attachment,
        list_activity, load_integration_settings, load_layout, normalize_google_client_secret,
        planner_get_item, planner_item_from_google_event, planner_list_items, planner_store_item,
        planner_upsert_google_item, sanitize_diagnostic, save_integration_settings, save_layout,
        system_sample_error, workspace_path,
    };
    use crate::agents::live_codex::ManagedSandbox;
    use crate::db::Database;
    use crate::events::{Actor, EventBus, EventEnvelope, EventKind, RedactionClass};
    use crate::terminal::{NativePtyAdapter, TerminalManager};
    use crate::workspace::WorkspaceRegistry;
    use crate::workspace::lsp::LspManager;
    use rusqlite::params;
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

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
    fn integration_settings_round_trip_with_normalized_google_client_id() {
        let database = Database::open(":memory:").expect("database");
        let saved = save_integration_settings(
            &database,
            IntegrationSettingsUpdate {
                google: GoogleIntegrationSettingsUpdate {
                    oauth_client_id: Some("  123-example.apps.googleusercontent.com  ".to_owned()),
                    oauth_client_secret: None,
                    consent_mode: GoogleConsentMode::ReadWrite,
                    calendar_enabled: true,
                    tasks_enabled: false,
                },
                codex: CodexIntegrationSettings {
                    default_sandbox: ManagedSandbox::WorkspaceWrite,
                },
            },
        )
        .expect("save");

        assert_eq!(
            saved.google.oauth_client_id.as_deref(),
            Some("123-example.apps.googleusercontent.com")
        );
        assert_eq!(saved.google.consent_mode, GoogleConsentMode::ReadWrite);
        assert_eq!(saved.codex.default_sandbox, ManagedSandbox::WorkspaceWrite);
        assert_eq!(load_integration_settings(&database).expect("load"), saved);
        let schema_version = database
            .with_connection(|connection| {
                connection.query_row(
                    "SELECT schema_version FROM app_settings WHERE key = ?1",
                    [INTEGRATION_SETTINGS_KEY],
                    |row| row.get::<_, u32>(0),
                )
            })
            .expect("schema version");
        assert_eq!(schema_version, 1);
    }

    #[test]
    fn integration_settings_reject_invalid_google_client_id() {
        let database = Database::open(":memory:").expect("database");
        let error = save_integration_settings(
            &database,
            IntegrationSettingsUpdate {
                google: GoogleIntegrationSettingsUpdate {
                    oauth_client_id: Some("not a client id".to_owned()),
                    ..GoogleIntegrationSettingsUpdate::default()
                },
                codex: CodexIntegrationSettings::default(),
            },
        )
        .expect_err("invalid client id");

        assert_eq!(error.code, "settings.google_client_id_invalid");
    }

    #[test]
    fn google_client_secret_is_trimmed_and_rejects_whitespace() {
        assert_eq!(
            normalize_google_client_secret(Some("  GOCSPX-secret  ".to_owned()))
                .expect("valid secret")
                .as_deref(),
            Some("GOCSPX-secret")
        );
        let error = normalize_google_client_secret(Some("secret value".to_owned()))
            .expect_err("whitespace must be rejected");
        assert_eq!(error.code, "settings.google_client_secret_invalid");
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
    fn diagnostic_text_is_redacted_and_bounded() {
        assert_eq!(
            sanitize_diagnostic("Bearer secret", 64),
            "[REDACTED] [REDACTED]"
        );
        assert_eq!(sanitize_diagnostic("123456789", 4), "1234");
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

    fn runtime_with_grant(expires_at: Instant) -> AppRuntime {
        let database = Database::open(":memory:").expect("database");
        AppRuntime {
            workspaces: Mutex::new(WorkspaceRegistry::new()),
            root_selection_grants: Mutex::new(BTreeMap::from([(
                "root_grant_test".into(),
                RootSelectionGrant {
                    canonical_path: PathBuf::from("C:/selected"),
                    display_path: "C:/selected".into(),
                    expires_at,
                },
            )])),
            database: Some(database.clone()),
            events: EventBus::with_audit_sink(Some(Arc::new(database))),
            agents: Mutex::new(CodexAppServerRuntime::new()),
            google_operation_active: std::sync::atomic::AtomicBool::new(false),
            terminals: Mutex::new(TerminalManager::new(NativePtyAdapter::new())),
            lsp: Mutex::new(LspManager::new()),
        }
    }

    #[test]
    fn activity_read_model_filters_projects_and_keeps_payloads_redacted() {
        let database = Database::open(":memory:").expect("database");
        let event = EventEnvelope::new(
            EventKind::Custom("project.updated".into()),
            serde_json::json!({
                "projectId": "project_alpha",
                "changedFields": ["progress"],
                "token": "Bearer definitely-secret"
            }),
            Some("brain".into()),
            Some("correlation_test".into()),
            Actor::system(),
            1,
            RedactionClass::Internal,
            true,
        )
        .expect("event");
        database.insert_audit_event(&event).expect("audit event");

        let page = list_activity(
            &database,
            &ActivityListRequest {
                workspace_id: Some("brain".into()),
                project_id: Some("project_alpha".into()),
                category: Some("history".into()),
                cursor: None,
                limit: Some(10),
            },
        )
        .expect("activity");

        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].event_type, "project.updated");
        assert_eq!(page.items[0].payload["token"], "[REDACTED] [REDACTED]");

        let other_project = list_activity(
            &database,
            &ActivityListRequest {
                workspace_id: None,
                project_id: Some("project_beta".into()),
                category: None,
                cursor: None,
                limit: None,
            },
        )
        .expect("activity");
        assert!(other_project.items.is_empty());
    }

    #[test]
    fn planner_items_persist_with_identity_schedule_and_project_filter() {
        let database = Database::open(":memory:").expect("database");
        let item = PlannerItemRecord {
            id: "planner_test".into(),
            kind: "task".into(),
            title: "Protect identity".into(),
            details: Some("Schedule and unschedule without replacing the item.".into()),
            location: Some("Studio 4".into()),
            schedule: Some(PlannerScheduleRecord::Exact {
                start_epoch_seconds: 1_800_000_000,
                end_epoch_seconds: Some(1_800_003_600),
                timezone: "Asia/Singapore".into(),
            }),
            status: "open".into(),
            project_id: Some("project_alpha".into()),
            source: "local".into(),
            source_link: None,
            provider_link: None,
            recurrence_rule: None,
            sync_status: "local_only".into(),
            conflict_message: None,
            created_at_epoch_seconds: 10,
            updated_at_epoch_seconds: 10,
        };
        planner_store_item(&database, "brain", &item, true).expect("insert planner item");

        let restored = planner_get_item(&database, "brain", "planner_test").expect("planner item");
        assert_eq!(restored.id, "planner_test");
        assert_eq!(restored.location.as_deref(), Some("Studio 4"));
        assert!(matches!(
            restored.schedule,
            Some(PlannerScheduleRecord::Exact {
                start_epoch_seconds: 1_800_000_000,
                ..
            })
        ));

        let project_items = planner_list_items(
            &database,
            &PlannerListRequest {
                brain_workspace_id: "brain".into(),
                project_id: Some("project_alpha".into()),
                range: None,
            },
        )
        .expect("project items");
        assert_eq!(project_items.len(), 1);

        let other_project = planner_list_items(
            &database,
            &PlannerListRequest {
                brain_workspace_id: "brain".into(),
                project_id: Some("project_beta".into()),
                range: None,
            },
        )
        .expect("other Project items");
        assert!(other_project.is_empty());
    }

    #[test]
    fn google_events_upsert_into_the_shared_planner_without_duplicate_identities() {
        let database = Database::open(":memory:").expect("database");
        let mut event = crate::planner::google::CalendarEvent {
            provider_id: "event_alpha".into(),
            calendar_id: "primary".into(),
            title: "Design review".into(),
            description: None,
            location: Some("Marina Bay Sands, Singapore".into()),
            start: "2026-08-22T09:00:00+08:00".into(),
            end: "2026-08-22T10:00:00+08:00".into(),
            timezone: Some("Asia/Singapore".into()),
            all_day: false,
            recurring_series_id: None,
            deleted: false,
            etag: Some("etag-one".into()),
            updated_at: "2026-08-22T01:00:00Z".into(),
            payload_hash: "hash-one".into(),
        };
        planner_upsert_google_item(
            &database,
            "brain",
            planner_item_from_google_event(&event),
            event.etag.as_deref(),
            &event.payload_hash,
        )
        .expect("first Google event");
        event.title = "Design review updated".into();
        event.etag = Some("etag-two".into());
        planner_upsert_google_item(
            &database,
            "brain",
            planner_item_from_google_event(&event),
            event.etag.as_deref(),
            &event.payload_hash,
        )
        .expect("updated Google event");

        let outside_range = planner_list_items(
            &database,
            &PlannerListRequest {
                brain_workspace_id: "brain".into(),
                project_id: None,
                range: Some(PlannerListRangeRecord {
                    start_date: "2026-07-01".into(),
                    end_date: "2026-08-01".into(),
                    start_epoch_seconds: 1_782_864_000,
                    end_epoch_seconds: 1_785_542_400,
                }),
            },
        )
        .expect("outside planner range");
        assert!(outside_range.is_empty());

        let items = planner_list_items(
            &database,
            &PlannerListRequest {
                brain_workspace_id: "brain".into(),
                project_id: None,
                range: Some(PlannerListRangeRecord {
                    start_date: "2026-08-01".into(),
                    end_date: "2026-09-01".into(),
                    start_epoch_seconds: 1_785_513_600,
                    end_epoch_seconds: 1_788_192_000,
                }),
            },
        )
        .expect("planner list");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Design review updated");
        assert_eq!(
            items[0].location.as_deref(),
            Some("Marina Bay Sands, Singapore")
        );
        assert_eq!(items[0].source, "provider");
        assert_eq!(
            items[0]
                .provider_link
                .as_ref()
                .map(|link| link.provider.as_str()),
            Some("google")
        );
    }

    #[test]
    fn root_selection_grants_are_consumed_once() {
        let runtime = runtime_with_grant(Instant::now() + Duration::from_secs(60));
        assert!(consume_root_selection(&runtime, "root_grant_test").is_ok());
        let second = consume_root_selection(&runtime, "root_grant_test").expect_err("one use");
        assert_eq!(second.code, "workspace.root_grant_invalid");
    }

    #[test]
    fn expired_root_selection_grants_fail_closed() {
        let runtime = runtime_with_grant(Instant::now() - Duration::from_secs(1));
        let result = consume_root_selection(&runtime, "root_grant_test").expect_err("expired");
        assert_eq!(result.code, "workspace.root_grant_invalid");
    }
}
