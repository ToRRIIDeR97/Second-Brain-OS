//! Managed Codex App Server runtime.
//!
//! This adapter intentionally supports one pinned protocol version. Every
//! thread and turn receives an explicit permission envelope so an agent can
//! never inherit a more permissive machine-level Codex configuration.

use crate::db::Database;
use crate::errors::{AppError, AppResult, redact_text};
use crate::platform::{Clock, SystemClock};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

const SUPPORTED_CODEX_VERSION: &str = "codex-cli 0.139.0";
const PROTOCOL_VERSION: u32 = 139;
const MAX_PROTOCOL_LINE_BYTES: usize = 1024 * 1024;
const MAX_PENDING_MESSAGES: usize = 1024;
const MAX_LIVE_SESSIONS: usize = 8;
const MAX_OBJECTIVE_CHARS: usize = 4_000;
const MAX_ASSISTANT_CHARS: usize = 100_000;
const MAX_TIMELINE_EVENTS: usize = 500;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedSandbox {
    ReadOnly,
    WorkspaceWrite,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartManagedSession {
    pub workspace_id: String,
    pub objective: String,
    pub sandbox: ManagedSandbox,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSessionRequest {
    pub workspace_id: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSessionMessageRequest {
    pub workspace_id: String,
    pub session_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedApprovalDecisionRequest {
    pub workspace_id: String,
    pub session_id: String,
    pub approval_id: String,
    pub decision: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProbe {
    pub provider: &'static str,
    pub status: &'static str,
    pub version: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRootSnapshot {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRootsSnapshot {
    pub readable: Vec<AgentRootSnapshot>,
    pub writable: Vec<AgentRootSnapshot>,
    pub writable_project_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalSnapshot {
    pub approval_id: String,
    pub risk_class: String,
    pub summary: String,
    pub target: String,
    pub decision: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeSnapshot {
    pub path: String,
    pub before_hash: Option<String>,
    pub after_hash: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSnapshot {
    pub id: String,
    pub workspace_id: String,
    pub provider: String,
    pub mode: String,
    pub profile_id: String,
    pub packet_id: String,
    pub objective: String,
    pub roots: AgentRootsSnapshot,
    pub state: String,
    pub assistant_text: String,
    pub pending_approvals: Vec<ApprovalSnapshot>,
    pub file_changes: Vec<FileChangeSnapshot>,
    pub validations: Vec<Value>,
    pub events: Vec<Value>,
    pub last_activity_at: Option<String>,
    pub current_action: Option<String>,
    pub error: Option<Value>,
}

#[derive(Clone, Debug)]
struct PendingApprovalRpc {
    request_id: Value,
    method: String,
}

struct LiveSession {
    child: Child,
    writer: Arc<Mutex<BufWriter<ChildStdin>>>,
    inbox: Arc<Mutex<VecDeque<Value>>>,
    thread_id: String,
    active_turn_id: Option<String>,
    pending_turn_request: Option<u64>,
    next_request_id: u64,
    next_sequence: u64,
    pending_approval_rpcs: BTreeMap<String, PendingApprovalRpc>,
    snapshot: AgentSessionSnapshot,
    cwd: PathBuf,
    sandbox: ManagedSandbox,
    model: String,
    effort: String,
}

impl Drop for LiveSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct CodexAppServerRuntime {
    sessions: BTreeMap<String, LiveSession>,
}

impl CodexAppServerRuntime {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn probe() -> ProviderProbe {
        match installed_codex_version() {
            Ok(version) if version == SUPPORTED_CODEX_VERSION => ProviderProbe {
                provider: "codex",
                status: "available",
                version: Some(version),
                reason: None,
            },
            Ok(version) => ProviderProbe {
                provider: "codex",
                status: "unavailable",
                reason: Some(format!(
                    "This build supports {SUPPORTED_CODEX_VERSION}; {version} is installed."
                )),
                version: Some(version),
            },
            Err(error) => ProviderProbe {
                provider: "codex",
                status: "unavailable",
                version: None,
                reason: Some(error.message),
            },
        }
    }

    pub fn start(
        &mut self,
        database: &Database,
        request: StartManagedSession,
        canonical_root: &Path,
        can_write: bool,
    ) -> AppResult<AgentSessionSnapshot> {
        validate_start(&request, canonical_root, can_write)?;
        self.pump_all(database)?;
        if self.sessions.len() >= MAX_LIVE_SESSIONS {
            let retired = self
                .sessions
                .iter()
                .find(|(_, session)| {
                    matches!(
                        session.snapshot.state.as_str(),
                        "completed" | "failed" | "recoverable"
                    )
                })
                .map(|(id, _)| id.clone());
            if let Some(id) = retired {
                self.sessions.remove(&id);
            }
        }
        if self.sessions.len() >= MAX_LIVE_SESSIONS {
            return Err(AppError::new(
                "agent.session_limit",
                "Wait for an active agent session to finish before starting another one.",
            ));
        }
        require_supported_codex()?;

        let mut child = spawn_app_server()?;
        let stdin = child.stdin.take().ok_or_else(|| {
            AppError::new(
                "agent.provider_start_failed",
                "Codex stdin was unavailable.",
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            AppError::new(
                "agent.provider_start_failed",
                "Codex stdout was unavailable.",
            )
        })?;
        let mut writer = BufWriter::new(stdin);
        let mut reader = BufReader::new(stdout);
        let mut deferred = VecDeque::new();

        request_sync(
            &mut writer,
            &mut reader,
            1,
            "initialize",
            json!({
                "clientInfo": {
                    "name": "second-brain-os",
                    "title": "Second Brain OS",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {"experimentalApi": false}
            }),
            &mut deferred,
        )?;
        write_protocol_message(&mut writer, &json!({"method": "initialized"}))?;
        let account = request_sync(
            &mut writer,
            &mut reader,
            2,
            "account/read",
            json!({}),
            &mut deferred,
        )?;
        if account
            .get("account")
            .is_none_or(|account| account.is_null())
            && account
                .get("requiresOpenaiAuth")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        {
            let _ = child.kill();
            return Err(AppError::new(
                "agent.authentication_required",
                "Sign in to Codex before starting a managed agent.",
            ));
        }
        let models = request_sync(
            &mut writer,
            &mut reader,
            3,
            "model/list",
            json!({"includeHidden": false, "limit": 100}),
            &mut deferred,
        )?;
        let (model, effort) = select_explicit_model(&models)?;

        let session_id = format!("agent_{}", ulid::Ulid::new());
        let packet_id = format!("packet_{}", ulid::Ulid::new());
        let profile_id = format!(
            "codex-managed-{}",
            match request.sandbox {
                ManagedSandbox::ReadOnly => "read-only",
                ManagedSandbox::WorkspaceWrite => "workspace-write",
            }
        );
        let permission = permission_envelope(request.sandbox, canonical_root);
        let writable_roots = permission
            .get("writableRoots")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let sandbox_name = match request.sandbox {
            ManagedSandbox::ReadOnly => "read-only",
            ManagedSandbox::WorkspaceWrite => "workspace-write",
        };
        let thread = request_sync(
            &mut writer,
            &mut reader,
            4,
            "thread/start",
            json!({
                "approvalPolicy": "on-request",
                "approvalsReviewer": "user",
                "config": {
                    "model_reasoning_effort": effort,
                    "sandbox_workspace_write": {
                        "writable_roots": writable_roots
                    }
                },
                "cwd": canonical_root,
                "ephemeral": true,
                "model": model,
                "sandbox": sandbox_name,
                "threadSource": "user"
            }),
            &mut deferred,
        )?;
        let thread_id = required_string(&thread, &["thread", "id"], "thread id")?;
        let turn = request_sync(
            &mut writer,
            &mut reader,
            5,
            "turn/start",
            turn_params(
                &thread_id,
                &request.objective,
                canonical_root,
                &model,
                &effort,
                permission.clone(),
            ),
            &mut deferred,
        )?;
        let turn_id = required_string(&turn, &["turn", "id"], "turn id")?;

        let writable = if request.sandbox == ManagedSandbox::WorkspaceWrite {
            vec![AgentRootSnapshot {
                project_id: request.workspace_id.clone(),
                relative_path: ".".to_owned(),
            }]
        } else {
            Vec::new()
        };
        let now = SystemClock.now_utc();
        let snapshot = AgentSessionSnapshot {
            id: session_id.clone(),
            workspace_id: request.workspace_id.clone(),
            provider: "codex".to_owned(),
            mode: "managed".to_owned(),
            profile_id: profile_id.clone(),
            packet_id: packet_id.clone(),
            objective: request.objective.trim().to_owned(),
            roots: AgentRootsSnapshot {
                readable: vec![AgentRootSnapshot {
                    project_id: request.workspace_id.clone(),
                    relative_path: ".".to_owned(),
                }],
                writable,
                writable_project_id: request.workspace_id.clone(),
            },
            state: "running".to_owned(),
            assistant_text: String::new(),
            pending_approvals: Vec::new(),
            file_changes: Vec::new(),
            validations: Vec::new(),
            events: vec![lifecycle_event(
                &session_id,
                "running",
                Some("Session started"),
                &now,
            )],
            last_activity_at: Some(now),
            current_action: Some("Working on the request".to_owned()),
            error: None,
        };
        persist_new_session(
            database,
            &snapshot,
            &thread_id,
            &model,
            &effort,
            PROTOCOL_VERSION,
        )?;
        persist_event(database, &session_id, 1, &snapshot.events[0])?;

        let inbox = Arc::new(Mutex::new(deferred));
        spawn_reader(reader, Arc::clone(&inbox));
        self.sessions.insert(
            session_id,
            LiveSession {
                child,
                writer: Arc::new(Mutex::new(writer)),
                inbox,
                thread_id,
                active_turn_id: Some(turn_id),
                pending_turn_request: None,
                next_request_id: 6,
                next_sequence: 2,
                pending_approval_rpcs: BTreeMap::new(),
                snapshot: snapshot.clone(),
                cwd: canonical_root.to_path_buf(),
                sandbox: request.sandbox,
                model,
                effort,
            },
        );
        Ok(snapshot)
    }

    pub fn pump_all(&mut self, database: &Database) -> AppResult<()> {
        for session in self.sessions.values_mut() {
            session.pump(database)?;
        }
        Ok(())
    }

    pub fn send_message(
        &mut self,
        database: &Database,
        request: &ManagedSessionMessageRequest,
    ) -> AppResult<()> {
        let session = self.session_mut(&request.workspace_id, &request.session_id)?;
        session.pump(database)?;
        if request.message.trim().is_empty()
            || request.message.chars().count() > MAX_OBJECTIVE_CHARS
        {
            return Err(AppError::new(
                "agent.invalid_message",
                "Agent messages must contain between 1 and 4,000 characters.",
            ));
        }
        if session.active_turn_id.is_some() || session.pending_turn_request.is_some() {
            return Err(AppError::new(
                "agent.turn_active",
                "Wait for the current agent turn to finish before sending another message.",
            ));
        }
        let id = session.next_request_id;
        session.next_request_id = session.next_request_id.saturating_add(1);
        let permission = permission_envelope(session.sandbox, &session.cwd);
        session.write(&json!({
            "id": id,
            "method": "turn/start",
            "params": turn_params(
                &session.thread_id,
                request.message.trim(),
                &session.cwd,
                &session.model,
                &session.effort,
                permission
            )
        }))?;
        session.pending_turn_request = Some(id);
        session.snapshot.state = "starting".to_owned();
        session.snapshot.current_action = Some("Starting the next turn".to_owned());
        persist_snapshot(database, &session.snapshot)?;
        Ok(())
    }

    pub fn cancel(
        &mut self,
        database: &Database,
        request: &ManagedSessionRequest,
    ) -> AppResult<()> {
        let session = self.session_mut(&request.workspace_id, &request.session_id)?;
        session.pump(database)?;
        let turn_id = session.active_turn_id.clone().ok_or_else(|| {
            AppError::new(
                "agent.no_active_turn",
                "This agent has no active turn to cancel.",
            )
        })?;
        let id = session.next_request_id;
        session.next_request_id = session.next_request_id.saturating_add(1);
        session.write(&json!({
            "id": id,
            "method": "turn/interrupt",
            "params": {"threadId": session.thread_id, "turnId": turn_id}
        }))?;
        session.snapshot.state = "canceling".to_owned();
        session.snapshot.current_action = Some("Canceling the active turn".to_owned());
        persist_snapshot(database, &session.snapshot)?;
        Ok(())
    }

    pub fn decide_approval(
        &mut self,
        database: &Database,
        request: &ManagedApprovalDecisionRequest,
    ) -> AppResult<()> {
        let session = self.session_mut(&request.workspace_id, &request.session_id)?;
        session.pump(database)?;
        let pending = session
            .pending_approval_rpcs
            .remove(&request.approval_id)
            .ok_or_else(|| {
                AppError::new(
                    "agent.approval_not_found",
                    "This approval request is no longer pending.",
                )
            })?;
        let approved = match request.decision.as_str() {
            "approved" => true,
            "denied" => false,
            _ => {
                return Err(AppError::new(
                    "agent.invalid_approval_decision",
                    "Approval decisions must be approved or denied.",
                ));
            }
        };
        let result = match pending.method.as_str() {
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
                json!({"decision": if approved { "accept" } else { "decline" }})
            }
            "item/permissions/requestApproval" => {
                if approved {
                    return Err(AppError::new(
                        "agent.permission_expansion_unsupported",
                        "Additional permission grants are not supported by this build. Keep the session inside its original roots.",
                    ));
                }
                json!({"permissions": {}, "scope": "turn"})
            }
            _ => {
                return Err(AppError::new(
                    "agent.approval_unsupported",
                    "This type of agent approval is not supported.",
                ));
            }
        };
        session.write(&json!({"id": pending.request_id, "result": result}))?;
        session
            .snapshot
            .pending_approvals
            .retain(|approval| approval.approval_id != request.approval_id);
        session.snapshot.state = "running".to_owned();
        session.snapshot.current_action = Some("Continuing after approval".to_owned());
        persist_snapshot(database, &session.snapshot)?;
        Ok(())
    }

    fn session_mut(&mut self, workspace_id: &str, session_id: &str) -> AppResult<&mut LiveSession> {
        let session = self.sessions.get_mut(session_id).ok_or_else(|| {
            AppError::new(
                "agent.session_not_live",
                "This session is not connected to a live provider process.",
            )
        })?;
        if session.snapshot.workspace_id != workspace_id {
            return Err(AppError::new(
                "agent.workspace_mismatch",
                "This agent session belongs to a different workspace.",
            ));
        }
        Ok(session)
    }
}

impl LiveSession {
    fn write(&self, value: &Value) -> AppResult<()> {
        let mut writer = self.writer.lock().map_err(|_| {
            AppError::new(
                "agent.provider_locked",
                "The Codex connection is unavailable.",
            )
        })?;
        write_protocol_message(&mut writer, value)
    }

    fn pump(&mut self, database: &Database) -> AppResult<()> {
        let messages = {
            let mut inbox = self.inbox.lock().map_err(|_| {
                AppError::new(
                    "agent.provider_locked",
                    "The Codex event queue is unavailable.",
                )
            })?;
            inbox.drain(..).collect::<Vec<_>>()
        };
        let mut changed = false;
        for message in messages {
            changed |= self.handle_message(database, &message)?;
        }
        if changed {
            persist_snapshot(database, &self.snapshot)?;
        }
        Ok(())
    }

    fn handle_message(&mut self, database: &Database, message: &Value) -> AppResult<bool> {
        if message.get("method").and_then(Value::as_str) == Some("process/exited") {
            if !matches!(self.snapshot.state.as_str(), "completed" | "failed") {
                self.snapshot.state = "recoverable".to_owned();
                self.snapshot.current_action = None;
                self.snapshot.error = Some(json!({
                    "code": "agent.provider_exited",
                    "message": "The Codex provider process exited. The saved session remains available.",
                    "retryable": true
                }));
                self.append_event(
                    database,
                    lifecycle_event(
                        &self.snapshot.id,
                        "recoverable",
                        Some("Provider process exited"),
                        &SystemClock.now_utc(),
                    ),
                )?;
            }
            return Ok(true);
        }

        if let Some(id) = message.get("id") {
            if message.get("method").is_some() {
                return self.handle_server_request(database, id.clone(), message);
            }
            if id.as_u64() == self.pending_turn_request {
                self.pending_turn_request = None;
                if let Some(error) = message.get("error") {
                    self.snapshot.state = "failed".to_owned();
                    self.snapshot.error = Some(json!({
                        "code": "agent.turn_start_failed",
                        "message": redact_text(error.get("message").and_then(Value::as_str).unwrap_or("The Codex turn could not be started.")),
                        "retryable": true
                    }));
                } else if let Some(turn_id) =
                    message.pointer("/result/turn/id").and_then(Value::as_str)
                {
                    self.active_turn_id = Some(turn_id.to_owned());
                    self.snapshot.state = "running".to_owned();
                    self.snapshot.current_action = Some("Working on the request".to_owned());
                }
                return Ok(true);
            }
            return Ok(false);
        }

        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let params = message.get("params").unwrap_or(&Value::Null);
        match method {
            "turn/started" => {
                self.active_turn_id = params
                    .pointer("/turn/id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| self.active_turn_id.clone());
                self.snapshot.state = "running".to_owned();
                self.snapshot.current_action = Some("Working on the request".to_owned());
                Ok(true)
            }
            "turn/completed" => {
                let status = params
                    .pointer("/turn/status")
                    .and_then(Value::as_str)
                    .unwrap_or("failed");
                self.active_turn_id = None;
                self.snapshot.current_action = None;
                let (state, summary) = match status {
                    "completed" => ("completed", "Turn completed"),
                    "interrupted" => ("completed", "Turn canceled"),
                    _ => ("failed", "Turn failed"),
                };
                self.snapshot.state = state.to_owned();
                if state == "failed" {
                    self.snapshot.error = Some(json!({
                        "code": "agent.turn_failed",
                        "message": params.pointer("/turn/error/message").and_then(Value::as_str).map(redact_text).unwrap_or_else(|| "The Codex turn failed.".to_owned()),
                        "retryable": true
                    }));
                }
                self.append_event(
                    database,
                    lifecycle_event(
                        &self.snapshot.id,
                        state,
                        Some(summary),
                        &SystemClock.now_utc(),
                    ),
                )?;
                Ok(true)
            }
            "item/started" => self.handle_item(database, params, false),
            "item/completed" => self.handle_item(database, params, true),
            "error" => {
                let text = params
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("The Codex provider reported an error.");
                let retryable = params
                    .get("willRetry")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if !retryable {
                    self.snapshot.state = "failed".to_owned();
                    self.snapshot.current_action = None;
                }
                self.snapshot.error = Some(json!({
                    "code": "agent.provider_error",
                    "message": redact_text(text),
                    "retryable": retryable
                }));
                self.append_event(
                    database,
                    json!({
                        "id": format!("agent_event_{}", ulid::Ulid::new()),
                        "sessionId": self.snapshot.id,
                        "occurredAt": SystemClock.now_utc(),
                        "type": "error",
                        "code": "agent.provider_error",
                        "message": redact_text(text),
                        "retryable": retryable
                    }),
                )?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    fn handle_server_request(
        &mut self,
        database: &Database,
        request_id: Value,
        message: &Value,
    ) -> AppResult<bool> {
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        if !matches!(
            method,
            "item/commandExecution/requestApproval"
                | "item/fileChange/requestApproval"
                | "item/permissions/requestApproval"
        ) {
            self.write(&json!({
                "id": request_id,
                "error": {"code": -32601, "message": "Unsupported client request"}
            }))?;
            return Ok(false);
        }
        let params = message.get("params").unwrap_or(&Value::Null);
        let approval_id = params
            .get("approvalId")
            .and_then(Value::as_str)
            .or_else(|| params.get("itemId").and_then(Value::as_str))
            .map(str::to_owned)
            .unwrap_or_else(|| format!("approval_{}", ulid::Ulid::new()));
        let (risk_class, summary, target) = match method {
            "item/commandExecution/requestApproval" => (
                "command_execution",
                "Run a command",
                params
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or("Command details unavailable"),
            ),
            "item/fileChange/requestApproval" => (
                "file_change",
                "Apply file changes",
                params
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("Current writable root"),
            ),
            _ => (
                "permission_expansion",
                "Request additional permissions",
                params
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("Outside the original session permissions"),
            ),
        };
        let approval = ApprovalSnapshot {
            approval_id: approval_id.clone(),
            risk_class: risk_class.to_owned(),
            summary: summary.to_owned(),
            target: redact_text(target),
            decision: "pending".to_owned(),
        };
        self.pending_approval_rpcs.insert(
            approval_id.clone(),
            PendingApprovalRpc {
                request_id,
                method: method.to_owned(),
            },
        );
        if !self
            .snapshot
            .pending_approvals
            .iter()
            .any(|item| item.approval_id == approval_id)
        {
            self.snapshot.pending_approvals.push(approval.clone());
        }
        self.snapshot.state = "waiting".to_owned();
        self.snapshot.current_action = Some("Waiting for approval".to_owned());
        self.append_event(
            database,
            json!({
                "id": format!("agent_event_{}", ulid::Ulid::new()),
                "sessionId": self.snapshot.id,
                "occurredAt": SystemClock.now_utc(),
                "type": "approval",
                "approval": approval
            }),
        )?;
        Ok(true)
    }

    fn handle_item(
        &mut self,
        database: &Database,
        params: &Value,
        completed: bool,
    ) -> AppResult<bool> {
        let item = params.get("item").unwrap_or(&Value::Null);
        let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
        match item_type {
            "agentMessage" if completed => {
                let text = item.get("text").and_then(Value::as_str).unwrap_or("");
                if text.is_empty() {
                    return Ok(false);
                }
                if !self.snapshot.assistant_text.is_empty() {
                    self.snapshot.assistant_text.push('\n');
                }
                self.snapshot.assistant_text.push_str(text);
                truncate_chars(&mut self.snapshot.assistant_text, MAX_ASSISTANT_CHARS);
                self.append_event(
                    database,
                    json!({
                        "id": format!("agent_event_{}", ulid::Ulid::new()),
                        "sessionId": self.snapshot.id,
                        "occurredAt": SystemClock.now_utc(),
                        "type": "assistant",
                        "text": text
                    }),
                )?;
                Ok(true)
            }
            "commandExecution" => {
                let command = item
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or("Command");
                let status = item.get("status").and_then(Value::as_str).unwrap_or("");
                let phase = if completed {
                    if status == "completed" {
                        "completed"
                    } else {
                        "failed"
                    }
                } else {
                    "started"
                };
                self.snapshot.current_action = (!completed).then(|| "Running a command".to_owned());
                self.append_event(
                    database,
                    json!({
                        "id": format!("agent_event_{}", ulid::Ulid::new()),
                        "sessionId": self.snapshot.id,
                        "occurredAt": SystemClock.now_utc(),
                        "type": "tool",
                        "tool": "shell",
                        "summary": redact_text(command),
                        "phase": phase
                    }),
                )?;
                Ok(true)
            }
            "fileChange" if completed => {
                let mut changed = false;
                for change in item
                    .get("changes")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let Some(path) = change.get("path").and_then(Value::as_str) else {
                        continue;
                    };
                    let relative =
                        relative_to(&self.cwd, Path::new(path)).unwrap_or_else(|| path.to_owned());
                    if Path::new(&relative).is_absolute()
                        || relative.split(['/', '\\']).any(|part| part == "..")
                    {
                        continue;
                    }
                    if !self
                        .snapshot
                        .file_changes
                        .iter()
                        .any(|item| item.path == relative)
                    {
                        self.snapshot.file_changes.push(FileChangeSnapshot {
                            path: relative.clone(),
                            before_hash: None,
                            after_hash: None,
                        });
                    }
                    let operation = change
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("modified");
                    self.append_event(
                        database,
                        json!({
                            "id": format!("agent_event_{}", ulid::Ulid::new()),
                            "sessionId": self.snapshot.id,
                            "occurredAt": SystemClock.now_utc(),
                            "type": "file_change",
                            "change": {"path": relative},
                            "operation": normalize_change_kind(operation)
                        }),
                    )?;
                    changed = true;
                }
                Ok(changed)
            }
            _ => Ok(false),
        }
    }

    fn append_event(&mut self, database: &Database, event: Value) -> AppResult<()> {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        persist_event(database, &self.snapshot.id, sequence, &event)?;
        self.snapshot.last_activity_at = event
            .get("occurredAt")
            .and_then(Value::as_str)
            .map(str::to_owned);
        self.snapshot.events.push(event);
        if self.snapshot.events.len() > MAX_TIMELINE_EVENTS {
            let excess = self.snapshot.events.len() - MAX_TIMELINE_EVENTS;
            self.snapshot.events.drain(0..excess);
        }
        Ok(())
    }
}

pub fn list_persisted_sessions(
    database: &Database,
    workspace_id: &str,
) -> AppResult<Vec<AgentSessionSnapshot>> {
    database.with_connection(|connection| {
        let mut statement = connection.prepare(
            "SELECT state, provider_mirror_json FROM agent_sessions
             WHERE workspace_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut sessions = Vec::new();
        for row in rows {
            let (state, value) = row?;
            if let Ok(mut snapshot) = serde_json::from_str::<AgentSessionSnapshot>(&value) {
                snapshot.state = state;
                if snapshot.state == "recoverable" {
                    snapshot.current_action = None;
                    snapshot.error = Some(json!({
                        "code": "agent.restart_required",
                        "message": "The provider process ended when the application closed. The session history is preserved.",
                        "retryable": true
                    }));
                }
                sessions.push(snapshot);
            }
        }
        Ok(sessions)
    })
}

pub fn mark_orphaned_sessions_recoverable(database: &Database) -> AppResult<()> {
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE agent_sessions
             SET state = 'recoverable', updated_at = ?1
             WHERE state IN ('starting', 'running', 'waiting', 'canceling')",
            [SystemClock.now_utc()],
        )?;
        Ok(())
    })
}

fn validate_start(
    request: &StartManagedSession,
    canonical_root: &Path,
    can_write: bool,
) -> AppResult<()> {
    let length = request.objective.trim().chars().count();
    if length == 0 || length > MAX_OBJECTIVE_CHARS {
        return Err(AppError::new(
            "agent.invalid_objective",
            "Agent requests must contain between 1 and 4,000 characters.",
        ));
    }
    if !canonical_root.is_absolute() || !canonical_root.is_dir() {
        return Err(AppError::new(
            "agent.invalid_root",
            "The managed agent requires a registered local workspace root.",
        ));
    }
    if request.sandbox == ManagedSandbox::WorkspaceWrite && !can_write {
        return Err(AppError::new(
            "agent.write_denied",
            "This workspace does not permit managed agent writes.",
        ));
    }
    Ok(())
}

fn installed_codex_version() -> AppResult<String> {
    let output = Command::new("codex")
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|_| {
            AppError::new(
                "agent.provider_unavailable",
                "Codex CLI is not installed or is not available on PATH.",
            )
        })?;
    if !output.status.success() {
        return Err(AppError::new(
            "agent.provider_unavailable",
            "Codex CLI did not report a usable version.",
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn require_supported_codex() -> AppResult<()> {
    let version = installed_codex_version()?;
    if version != SUPPORTED_CODEX_VERSION {
        return Err(AppError::new(
            "agent.protocol_unsupported",
            format!("This build supports {SUPPORTED_CODEX_VERSION}; {version} is installed."),
        ));
    }
    Ok(())
}

fn spawn_app_server() -> AppResult<Child> {
    let mut command = Command::new("codex");
    command
        .args(["app-server", "--stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.spawn().map_err(|_| {
        AppError::new(
            "agent.provider_start_failed",
            "The Codex App Server could not be started.",
        )
        .retryable(true)
    })
}

fn request_sync(
    writer: &mut BufWriter<ChildStdin>,
    reader: &mut BufReader<ChildStdout>,
    id: u64,
    method: &str,
    params: Value,
    deferred: &mut VecDeque<Value>,
) -> AppResult<Value> {
    write_protocol_message(
        writer,
        &json!({"id": id, "method": method, "params": params}),
    )?;
    loop {
        let line = read_bounded_line(reader)?;
        if line.is_empty() {
            return Err(AppError::new(
                "agent.provider_exited",
                "Codex App Server exited during initialization.",
            )
            .retryable(true));
        }
        let message: Value = serde_json::from_slice(&line).map_err(|_| {
            AppError::new(
                "agent.protocol_invalid",
                "Codex App Server returned an invalid protocol message.",
            )
        })?;
        if message.get("id").and_then(Value::as_u64) == Some(id) && message.get("method").is_none()
        {
            if let Some(error) = message.get("error") {
                return Err(AppError::new(
                    "agent.provider_request_failed",
                    error
                        .get("message")
                        .and_then(Value::as_str)
                        .map(redact_text)
                        .unwrap_or_else(|| "Codex rejected the provider request.".to_owned()),
                ));
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
        if deferred.len() == MAX_PENDING_MESSAGES {
            deferred.pop_front();
        }
        deferred.push_back(message);
    }
}

fn write_protocol_message(writer: &mut BufWriter<ChildStdin>, value: &Value) -> AppResult<()> {
    let bytes = serde_json::to_vec(value).map_err(|_| {
        AppError::new(
            "agent.protocol_serialize",
            "The Codex request could not be serialized.",
        )
    })?;
    if bytes.len() > MAX_PROTOCOL_LINE_BYTES {
        return Err(AppError::new(
            "agent.protocol_too_large",
            "The Codex request exceeded the local protocol limit.",
        ));
    }
    writer.write_all(&bytes)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

fn read_bounded_line<R: BufRead>(reader: &mut R) -> AppResult<Vec<u8>> {
    let mut output = Vec::new();
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok(output);
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(buffer.len(), |position| position + 1);
        let content = newline.map_or(buffer, |position| &buffer[..position]);
        if output.len().saturating_add(content.len()) > MAX_PROTOCOL_LINE_BYTES {
            reader.consume(consumed);
            while newline.is_none() {
                let remaining = reader.fill_buf()?;
                if remaining.is_empty() {
                    break;
                }
                let next_newline = remaining.iter().position(|byte| *byte == b'\n');
                let next_consumed = next_newline.map_or(remaining.len(), |position| position + 1);
                reader.consume(next_consumed);
                if next_newline.is_some() {
                    break;
                }
            }
            return Err(AppError::new(
                "agent.protocol_too_large",
                "Codex App Server returned an oversized protocol message.",
            ));
        }
        output.extend_from_slice(content);
        reader.consume(consumed);
        if newline.is_some() {
            return Ok(output);
        }
    }
}

fn spawn_reader(mut reader: BufReader<ChildStdout>, inbox: Arc<Mutex<VecDeque<Value>>>) {
    thread::spawn(move || {
        loop {
            let Ok(line) = read_bounded_line(&mut reader) else {
                break;
            };
            if line.is_empty() {
                break;
            }
            let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            let Ok(mut queue) = inbox.lock() else {
                break;
            };
            if queue.len() == MAX_PENDING_MESSAGES {
                queue.pop_front();
            }
            queue.push_back(message);
        }
        if let Ok(mut queue) = inbox.lock() {
            if queue.len() == MAX_PENDING_MESSAGES {
                queue.pop_front();
            }
            queue.push_back(json!({"method": "process/exited", "params": {}}));
        }
    });
}

fn select_explicit_model(models: &Value) -> AppResult<(String, String)> {
    let models = models
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::new(
                "agent.model_unavailable",
                "Codex did not advertise an available model.",
            )
        })?;
    let model = models
        .iter()
        .find(|model| model.get("isDefault").and_then(Value::as_bool) == Some(true))
        .or_else(|| {
            models
                .iter()
                .find(|model| model.get("hidden").and_then(Value::as_bool) == Some(false))
        })
        .ok_or_else(|| {
            AppError::new(
                "agent.model_unavailable",
                "Codex did not advertise an available model.",
            )
        })?;
    let model_id = model
        .get("model")
        .or_else(|| model.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "agent.model_unavailable",
                "Codex returned a model without an identifier.",
            )
        })?;
    let effort = model
        .get("defaultReasoningEffort")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "agent.model_unavailable",
                "Codex returned a model without a reasoning level.",
            )
        })?;
    Ok((model_id.to_owned(), effort.to_owned()))
}

fn permission_envelope(sandbox: ManagedSandbox, root: &Path) -> Value {
    match sandbox {
        ManagedSandbox::ReadOnly => json!({"type": "readOnly", "networkAccess": false}),
        ManagedSandbox::WorkspaceWrite => json!({
            "type": "workspaceWrite",
            "writableRoots": [root],
            "networkAccess": false,
            "excludeSlashTmp": true,
            "excludeTmpdirEnvVar": true
        }),
    }
}

fn turn_params(
    thread_id: &str,
    message: &str,
    cwd: &Path,
    model: &str,
    effort: &str,
    sandbox_policy: Value,
) -> Value {
    json!({
        "threadId": thread_id,
        "approvalPolicy": "on-request",
        "approvalsReviewer": "user",
        "cwd": cwd,
        "effort": effort,
        "input": [{"type": "text", "text": message, "text_elements": []}],
        "model": model,
        "sandboxPolicy": sandbox_policy
    })
}

fn required_string(value: &Value, path: &[&str], label: &str) -> AppResult<String> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment).unwrap_or(&Value::Null);
    }
    current.as_str().map(str::to_owned).ok_or_else(|| {
        AppError::new(
            "agent.protocol_invalid",
            format!("Codex did not return a valid {label}."),
        )
    })
}

fn persist_new_session(
    database: &Database,
    snapshot: &AgentSessionSnapshot,
    provider_session_id: &str,
    model: &str,
    effort: &str,
    protocol_version: u32,
) -> AppResult<()> {
    let now = snapshot
        .last_activity_at
        .clone()
        .unwrap_or_else(|| SystemClock.now_utc());
    let snapshot_json = serde_json::to_string(snapshot).map_err(|_| {
        AppError::new(
            "agent.session_serialize",
            "The managed agent session could not be saved.",
        )
    })?;
    let readable = serde_json::to_string(&snapshot.roots.readable).unwrap_or_else(|_| "[]".into());
    let writable = serde_json::to_string(&snapshot.roots.writable).unwrap_or_else(|_| "[]".into());
    let fingerprint = blake3::hash(
        format!(
            "{}\0{}\0{}",
            snapshot.workspace_id, snapshot.id, snapshot.objective
        )
        .as_bytes(),
    )
    .to_hex()
    .to_string();
    database.transaction(|transaction| {
        transaction.execute(
            "INSERT OR IGNORE INTO agent_profiles (
                profile_id, provider, name, model, reasoning_mode,
                protocol_version, options_json, created_at, updated_at
             ) VALUES (?1, 'codex', 'Managed Codex', ?2, ?3, ?4, '{}', ?5, ?5)",
            params![snapshot.profile_id, model, effort, protocol_version, now],
        )?;
        transaction.execute(
            "INSERT INTO context_packets (
                packet_id, workspace_id, contract_version, objective, fingerprint,
                estimator, token_budget, token_count, index_generation, policy_json,
                approval_state, serialized_json, state, created_at
             ) VALUES (?1, ?2, 1, ?3, ?4, 'local', 1, 0, 0, '{}',
                'approved', '{}', 'used', ?5)",
            params![
                snapshot.packet_id,
                snapshot.workspace_id,
                snapshot.objective,
                fingerprint,
                now
            ],
        )?;
        transaction.execute(
            "INSERT INTO agent_sessions (
                session_id, provider_session_id, profile_id, workspace_id,
                context_packet_id, state, readable_roots_json, writable_roots_json,
                provider_mirror_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                snapshot.id,
                provider_session_id,
                snapshot.profile_id,
                snapshot.workspace_id,
                snapshot.packet_id,
                snapshot.state,
                readable,
                writable,
                snapshot_json,
                now
            ],
        )?;
        Ok(())
    })
}

fn persist_snapshot(database: &Database, snapshot: &AgentSessionSnapshot) -> AppResult<()> {
    let value = serde_json::to_string(snapshot).map_err(|_| {
        AppError::new(
            "agent.session_serialize",
            "The managed agent session could not be saved.",
        )
    })?;
    database.with_connection(|connection| {
        connection.execute(
            "UPDATE agent_sessions
             SET state = ?1, provider_mirror_json = ?2, updated_at = ?3
             WHERE session_id = ?4 AND workspace_id = ?5",
            params![
                snapshot.state,
                value,
                snapshot
                    .last_activity_at
                    .as_deref()
                    .unwrap_or("1970-01-01T00:00:00Z"),
                snapshot.id,
                snapshot.workspace_id
            ],
        )?;
        Ok(())
    })
}

fn persist_event(
    database: &Database,
    session_id: &str,
    sequence: u64,
    event: &Value,
) -> AppResult<()> {
    let event_id = event
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::new("agent.event_invalid", "The agent event had no id."))?;
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let occurred_at = event
        .get("occurredAt")
        .and_then(Value::as_str)
        .unwrap_or("1970-01-01T00:00:00Z");
    let payload = serde_json::to_string(event).map_err(|_| {
        AppError::new(
            "agent.event_serialize",
            "The managed agent event could not be saved.",
        )
    })?;
    let sequence = i64::try_from(sequence).unwrap_or(i64::MAX);
    database.with_connection(|connection| {
        connection.execute(
            "INSERT OR IGNORE INTO agent_events (
                session_id, event_id, sequence, event_type, payload_json, occurred_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                session_id,
                event_id,
                sequence,
                event_type,
                payload,
                occurred_at
            ],
        )?;
        Ok(())
    })
}

fn lifecycle_event(session_id: &str, state: &str, summary: Option<&str>, now: &str) -> Value {
    json!({
        "id": format!("agent_event_{}", ulid::Ulid::new()),
        "sessionId": session_id,
        "occurredAt": now,
        "type": "lifecycle",
        "state": state,
        "summary": summary
    })
}

fn relative_to(root: &Path, path: &Path) -> Option<String> {
    let relative = if path.is_absolute() {
        path.strip_prefix(root).ok()?
    } else {
        path
    };
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn normalize_change_kind(kind: &str) -> &'static str {
    match kind.to_ascii_lowercase().as_str() {
        "add" | "created" => "created",
        "delete" | "deleted" => "deleted",
        "rename" | "renamed" => "renamed",
        _ => "modified",
    }
}

fn truncate_chars(value: &mut String, max_chars: usize) {
    if value.chars().count() <= max_chars {
        return;
    }
    let start = value
        .char_indices()
        .nth(value.chars().count() - max_chars)
        .map_or(0, |(index, _)| index);
    value.drain(..start);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_envelopes_never_use_danger_full_access() {
        let root = Path::new("C:/workspace");
        let read_only = permission_envelope(ManagedSandbox::ReadOnly, root);
        let writable = permission_envelope(ManagedSandbox::WorkspaceWrite, root);
        assert_eq!(read_only["type"], "readOnly");
        assert_eq!(read_only["networkAccess"], false);
        assert_eq!(writable["type"], "workspaceWrite");
        assert_eq!(writable["networkAccess"], false);
        assert_eq!(writable["writableRoots"][0], "C:/workspace");
    }

    #[test]
    fn turn_params_are_explicit_and_bounded_to_the_selected_root() {
        let params = turn_params(
            "thread_1",
            "Review the project",
            Path::new("C:/workspace"),
            "gpt-test",
            "medium",
            permission_envelope(ManagedSandbox::WorkspaceWrite, Path::new("C:/workspace")),
        );
        assert_eq!(params["approvalPolicy"], "on-request");
        assert_eq!(params["approvalsReviewer"], "user");
        assert_eq!(params["model"], "gpt-test");
        assert_eq!(params["effort"], "medium");
        assert_eq!(params["sandboxPolicy"]["type"], "workspaceWrite");
        assert_eq!(
            params["sandboxPolicy"]["writableRoots"]
                .as_array()
                .map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn model_selection_uses_the_advertised_default() {
        let response = json!({
            "data": [
                {"model": "other", "isDefault": false, "hidden": false, "defaultReasoningEffort": "low"},
                {"model": "chosen", "isDefault": true, "hidden": false, "defaultReasoningEffort": "high"}
            ]
        });
        assert_eq!(
            select_explicit_model(&response).expect("model"),
            ("chosen".to_owned(), "high".to_owned())
        );
    }

    #[test]
    fn persisted_sessions_round_trip_without_raw_protocol_data() {
        let database = Database::open(":memory:").expect("database");
        let now = "2026-08-22T00:00:00Z";
        let snapshot = AgentSessionSnapshot {
            id: "agent_test".into(),
            workspace_id: "brain".into(),
            provider: "codex".into(),
            mode: "managed".into(),
            profile_id: "codex-managed-read-only".into(),
            packet_id: "packet_test".into(),
            objective: "Review".into(),
            roots: AgentRootsSnapshot {
                readable: vec![AgentRootSnapshot {
                    project_id: "brain".into(),
                    relative_path: ".".into(),
                }],
                writable: Vec::new(),
                writable_project_id: "brain".into(),
            },
            state: "completed".into(),
            assistant_text: "Done".into(),
            pending_approvals: Vec::new(),
            file_changes: Vec::new(),
            validations: Vec::new(),
            events: vec![lifecycle_event(
                "agent_test",
                "completed",
                Some("Done"),
                now,
            )],
            last_activity_at: Some(now.into()),
            current_action: None,
            error: None,
        };
        persist_new_session(
            &database,
            &snapshot,
            "thread_test",
            "model",
            "medium",
            PROTOCOL_VERSION,
        )
        .expect("persist");
        persist_event(&database, "agent_test", 1, &snapshot.events[0]).expect("event");
        let restored = list_persisted_sessions(&database, "brain").expect("list");
        assert_eq!(restored, vec![snapshot]);
    }
}
