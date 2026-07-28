//! Provider-neutral agent contracts.
//!
//! Provider payloads stop at the adapter boundary.  These types are deliberately
//! small enough to persist or send over IPC without carrying raw protocol data.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Component, Path};

pub const AGENT_MODEL_VERSION: u32 = 1;

pub type AgentId = String;
pub type SessionId = String;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Codex,
    Claude,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    Managed,
    Visible,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxMode {
    ReadOnly,
    WorkspaceWrite,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalPolicy {
    Never,
    OnRequest,
    Always,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: AgentId,
    pub provider: ProviderKind,
    pub mode: AgentMode,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub context_budget: u32,
    pub sandbox: SandboxMode,
    pub approval_policy: ApprovalPolicy,
    #[serde(default)]
    pub mcp_tools: Vec<String>,
}

impl AgentProfile {
    pub fn validate(&self) -> Result<(), AgentModelError> {
        if self.id.trim().is_empty() || self.context_budget == 0 {
            return Err(AgentModelError::InvalidProfile);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRoots {
    pub project_id: String,
    #[serde(default)]
    pub readable_roots: Vec<String>,
    #[serde(default)]
    pub writable_roots: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRoots {
    pub readable: Vec<ScopedRoot>,
    pub writable: Vec<ScopedRoot>,
    pub writable_project_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedRoot {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RootResolutionError {
    NoProjects,
    EmptyProjectId,
    InvalidRoot(String),
    WritableProjectNotFound(String),
    WritableRootUnavailable(String),
}

/// Resolve all projects as readable while assigning writes to one project.
/// This is the cross-project safety default: callers must explicitly select a
/// different writable project, and this function never returns two writable
/// project roots.
pub fn resolve_roots(
    primary: ProjectRoots,
    secondary: &[ProjectRoots],
    writable_project_id: Option<&str>,
) -> Result<ResolvedRoots, RootResolutionError> {
    let mut projects = Vec::with_capacity(1 + secondary.len());
    projects.push(primary);
    projects.extend_from_slice(secondary);
    if projects.is_empty() {
        return Err(RootResolutionError::NoProjects);
    }

    for project in &projects {
        if project.project_id.trim().is_empty() {
            return Err(RootResolutionError::EmptyProjectId);
        }
        for root in project
            .readable_roots
            .iter()
            .chain(project.writable_roots.iter())
        {
            validate_relative_root(root)?;
        }
    }

    let writable_id = writable_project_id
        .map(str::to_owned)
        .unwrap_or_else(|| projects[0].project_id.clone());
    let writable = projects
        .iter()
        .find(|project| project.project_id == writable_id)
        .ok_or_else(|| RootResolutionError::WritableProjectNotFound(writable_id.clone()))?;
    if writable.writable_roots.is_empty() {
        return Err(RootResolutionError::WritableRootUnavailable(writable_id));
    }

    let readable = projects
        .iter()
        .flat_map(|project| {
            project.readable_roots.iter().map(|root| ScopedRoot {
                project_id: project.project_id.clone(),
                relative_path: root.clone(),
            })
        })
        .collect();
    let writable = writable
        .writable_roots
        .iter()
        .map(|root| ScopedRoot {
            project_id: writable.project_id.clone(),
            relative_path: root.clone(),
        })
        .collect();
    Ok(ResolvedRoots {
        readable,
        writable,
        writable_project_id: writable_id,
    })
}

pub fn validate_relative_root(root: &str) -> Result<(), RootResolutionError> {
    if root.is_empty() || root.contains('\\') || root.as_bytes().contains(&0) {
        return Err(RootResolutionError::InvalidRoot(root.to_owned()));
    }
    let path = Path::new(root);
    if path.is_absolute()
        || root.starts_with('/')
        || root.as_bytes().get(1).is_some_and(|byte| *byte == b':')
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(RootResolutionError::InvalidRoot(root.to_owned()));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Created,
    Starting,
    Running,
    Waiting,
    Canceling,
    Completed,
    Failed,
    Recoverable,
}

impl AgentState {
    #[must_use]
    pub const fn terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    Pending,
    Approved,
    Denied,
    Expired,
    Canceled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub approval_id: String,
    pub risk_class: String,
    pub summary: String,
    pub target: String,
    pub decision: ApprovalDecision,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub before_hash: Option<String>,
    pub after_hash: Option<String>,
}

impl FileChange {
    pub fn validate(&self) -> Result<(), AgentModelError> {
        validate_relative_root(&self.path).map_err(|_| AgentModelError::InvalidFilePath)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub validation_id: String,
    pub command_id: String,
    pub passed: bool,
    pub summary: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AgentEventKind {
    Started,
    AssistantText {
        text: String,
    },
    ToolStarted {
        call_id: String,
        name: String,
    },
    ToolFinished {
        call_id: String,
        success: bool,
    },
    ApprovalRequested {
        request: ApprovalRequest,
    },
    ApprovalResolved {
        approval_id: String,
        decision: ApprovalDecision,
    },
    FileChanged {
        change: FileChange,
    },
    ValidationCompleted {
        result: ValidationResult,
    },
    Usage {
        usage: Usage,
    },
    Completed,
    Canceled,
    Failed {
        code: String,
        message: String,
        retryable: bool,
    },
    Recoverable {
        reason: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub event_id: String,
    pub session_id: SessionId,
    pub sequence: Option<u64>,
    pub kind: AgentEventKind,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentSession {
    pub session_id: SessionId,
    pub workspace_id: String,
    pub profile: AgentProfile,
    pub packet_id: String,
    pub objective: String,
    pub roots: ResolvedRoots,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: SessionId,
    pub workspace_id: String,
    pub provider: ProviderKind,
    pub mode: AgentMode,
    pub profile_id: AgentId,
    pub packet_id: String,
    pub objective: String,
    pub roots: ResolvedRoots,
    pub state: AgentState,
    pub last_sequence: Option<u64>,
    #[serde(skip)]
    pub seen_event_ids: BTreeSet<String>,
    pub pending_approvals: Vec<ApprovalRequest>,
    pub assistant_text: String,
    pub tool_events: Vec<String>,
    pub file_changes: Vec<FileChange>,
    pub validations: Vec<ValidationResult>,
    pub usage: Option<Usage>,
    pub error: Option<AgentErrorSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentErrorSummary {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AgentModelError {
    InvalidProfile,
    InvalidFilePath,
    InvalidState,
    InvalidEvent,
    SessionMismatch,
}

impl AgentSession {
    #[must_use]
    pub fn new(request: &StartAgentSession) -> Self {
        Self {
            id: request.session_id.clone(),
            workspace_id: request.workspace_id.clone(),
            provider: request.profile.provider,
            mode: request.profile.mode,
            profile_id: request.profile.id.clone(),
            packet_id: request.packet_id.clone(),
            objective: request.objective.clone(),
            roots: request.roots.clone(),
            state: AgentState::Created,
            last_sequence: None,
            seen_event_ids: BTreeSet::new(),
            pending_approvals: Vec::new(),
            assistant_text: String::new(),
            tool_events: Vec::new(),
            file_changes: Vec::new(),
            validations: Vec::new(),
            usage: None,
            error: None,
        }
    }

    /// Applies one normalized provider event. Event IDs and sequence numbers
    /// make retries and late delivery harmless.
    pub fn apply(&mut self, event: &AgentEvent) -> EventDisposition {
        if event.session_id != self.id {
            return EventDisposition::Rejected(AgentModelError::SessionMismatch);
        }
        if self.seen_event_ids.contains(&event.event_id) {
            return EventDisposition::Duplicate;
        }
        if event
            .sequence
            .is_some_and(|seq| self.last_sequence.is_some_and(|last| seq <= last))
        {
            self.seen_event_ids.insert(event.event_id.clone());
            return EventDisposition::Stale;
        }
        let result = match &event.kind {
            AgentEventKind::Started => self.transition(AgentState::Running),
            AgentEventKind::AssistantText { text } => {
                if self.state.terminal() || self.state == AgentState::Canceling {
                    Err(AgentModelError::InvalidState)
                } else {
                    self.assistant_text.push_str(text);
                    if self.state == AgentState::Created || self.state == AgentState::Starting {
                        self.state = AgentState::Running;
                    }
                    Ok(())
                }
            }
            AgentEventKind::ToolStarted { call_id, name } => {
                if self.state.terminal() {
                    Err(AgentModelError::InvalidState)
                } else {
                    self.tool_events.push(format!("started:{call_id}:{name}"));
                    self.state = AgentState::Running;
                    Ok(())
                }
            }
            AgentEventKind::ToolFinished { call_id, success } => {
                if self.state.terminal() {
                    Err(AgentModelError::InvalidState)
                } else {
                    self.tool_events
                        .push(format!("finished:{call_id}:{success}"));
                    Ok(())
                }
            }
            AgentEventKind::ApprovalRequested { request } => {
                if self.state.terminal() {
                    Err(AgentModelError::InvalidState)
                } else if self
                    .pending_approvals
                    .iter()
                    .any(|item| item.approval_id == request.approval_id)
                {
                    Ok(())
                } else {
                    self.pending_approvals.push(request.clone());
                    self.state = AgentState::Waiting;
                    Ok(())
                }
            }
            AgentEventKind::ApprovalResolved {
                approval_id,
                decision,
            } => {
                let Some(approval) = self
                    .pending_approvals
                    .iter_mut()
                    .find(|item| item.approval_id == *approval_id)
                else {
                    return EventDisposition::Rejected(AgentModelError::InvalidEvent);
                };
                approval.decision = *decision;
                if !matches!(decision, ApprovalDecision::Pending) {
                    self.pending_approvals
                        .retain(|item| item.approval_id != *approval_id);
                    if self.state == AgentState::Waiting {
                        self.state = AgentState::Running;
                    }
                }
                Ok(())
            }
            AgentEventKind::FileChanged { change } => {
                if let Err(error) = change.validate() {
                    return EventDisposition::Rejected(error);
                }
                if !self.file_changes.iter().any(|item| item == change) {
                    self.file_changes.push(change.clone());
                }
                Ok(())
            }
            AgentEventKind::ValidationCompleted { result } => {
                self.validations.push(result.clone());
                Ok(())
            }
            AgentEventKind::Usage { usage } => {
                self.usage = Some(usage.clone());
                Ok(())
            }
            AgentEventKind::Completed => self.transition(AgentState::Completed),
            AgentEventKind::Canceled => self.transition(AgentState::Completed),
            AgentEventKind::Failed {
                code,
                message,
                retryable,
            } => {
                self.error = Some(AgentErrorSummary {
                    code: code.clone(),
                    message: message.clone(),
                    retryable: *retryable,
                });
                self.transition(AgentState::Failed)
            }
            AgentEventKind::Recoverable { reason } => {
                self.error = Some(AgentErrorSummary {
                    code: "provider.recoverable".to_owned(),
                    message: reason.clone(),
                    retryable: true,
                });
                self.transition(AgentState::Recoverable)
            }
        };
        match result {
            Ok(()) => {
                if let Some(sequence) = event.sequence {
                    self.last_sequence = Some(sequence);
                }
                self.seen_event_ids.insert(event.event_id.clone());
                EventDisposition::Applied
            }
            Err(error) => EventDisposition::Rejected(error),
        }
    }

    pub fn start(&mut self) -> Result<(), AgentModelError> {
        self.transition(AgentState::Starting)
    }

    pub fn request_cancel(&mut self) -> Result<(), AgentModelError> {
        if self.state.terminal() || self.state == AgentState::Recoverable {
            return Err(AgentModelError::InvalidState);
        }
        self.state = AgentState::Canceling;
        Ok(())
    }

    pub fn resume(&mut self) -> Result<(), AgentModelError> {
        if self.state != AgentState::Recoverable {
            return Err(AgentModelError::InvalidState);
        }
        self.state = AgentState::Starting;
        self.error = None;
        Ok(())
    }

    fn transition(&mut self, next: AgentState) -> Result<(), AgentModelError> {
        let allowed = match (self.state, next) {
            (AgentState::Created, AgentState::Starting | AgentState::Running)
            | (
                AgentState::Starting,
                AgentState::Running | AgentState::Failed | AgentState::Recoverable,
            )
            | (
                AgentState::Running,
                AgentState::Waiting
                | AgentState::Canceling
                | AgentState::Completed
                | AgentState::Failed
                | AgentState::Recoverable,
            )
            | (
                AgentState::Waiting,
                AgentState::Running
                | AgentState::Canceling
                | AgentState::Completed
                | AgentState::Failed
                | AgentState::Recoverable,
            )
            | (
                AgentState::Canceling,
                AgentState::Completed | AgentState::Failed | AgentState::Recoverable,
            )
            | (AgentState::Recoverable, AgentState::Starting) => true,
            (current, requested) if current == requested => true,
            _ => false,
        };
        if allowed {
            self.state = next;
            Ok(())
        } else {
            Err(AgentModelError::InvalidState)
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EventDisposition {
    Applied,
    Duplicate,
    Stale,
    Rejected(AgentModelError),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> StartAgentSession {
        let profile = AgentProfile {
            id: "developer".to_owned(),
            provider: ProviderKind::Codex,
            mode: AgentMode::Managed,
            model: Some("configured".to_owned()),
            reasoning: None,
            context_budget: 100,
            sandbox: SandboxMode::WorkspaceWrite,
            approval_policy: ApprovalPolicy::OnRequest,
            mcp_tools: vec!["brain.search".to_owned()],
        };
        let roots = resolve_roots(
            ProjectRoots {
                project_id: "primary".to_owned(),
                readable_roots: vec![".".to_owned()],
                writable_roots: vec!["src".to_owned()],
            },
            &[ProjectRoots {
                project_id: "secondary".to_owned(),
                readable_roots: vec!["docs".to_owned()],
                writable_roots: vec![".".to_owned()],
            }],
            None,
        )
        .expect("roots");
        StartAgentSession {
            session_id: "agent_1".to_owned(),
            workspace_id: "ws_1".to_owned(),
            profile,
            packet_id: "packet_1".to_owned(),
            objective: "Review".to_owned(),
            roots,
        }
    }

    #[test]
    fn defaults_writes_to_primary_project() {
        let roots = &request().roots;
        assert_eq!(roots.writable_project_id, "primary");
        assert!(
            roots
                .writable
                .iter()
                .all(|root| root.project_id == "primary")
        );
        assert_eq!(roots.readable.len(), 2);
    }

    #[test]
    fn duplicate_and_late_events_are_safe() {
        let mut session = AgentSession::new(&request());
        session.start().expect("start");
        let started = AgentEvent {
            event_id: "event_1".to_owned(),
            session_id: "agent_1".to_owned(),
            sequence: Some(1),
            kind: AgentEventKind::Started,
        };
        assert_eq!(session.apply(&started), EventDisposition::Applied);
        assert_eq!(session.apply(&started), EventDisposition::Duplicate);
        let late = AgentEvent {
            event_id: "event_0".to_owned(),
            session_id: "agent_1".to_owned(),
            sequence: Some(0),
            kind: AgentEventKind::Completed,
        };
        assert_eq!(session.apply(&late), EventDisposition::Stale);
        assert_eq!(session.state, AgentState::Running);
    }

    #[test]
    fn approval_waits_then_resumes_and_file_changes_are_relative() {
        let mut session = AgentSession::new(&request());
        session.start().expect("start");
        session.apply(&AgentEvent {
            event_id: "event_1".to_owned(),
            session_id: "agent_1".to_owned(),
            sequence: Some(1),
            kind: AgentEventKind::Started,
        });
        assert_eq!(
            session.apply(&AgentEvent {
                event_id: "event_2".to_owned(),
                session_id: "agent_1".to_owned(),
                sequence: Some(2),
                kind: AgentEventKind::ApprovalRequested {
                    request: ApprovalRequest {
                        approval_id: "approval_1".to_owned(),
                        risk_class: "local_reversible_write".to_owned(),
                        summary: "Write source".to_owned(),
                        target: "src/main.rs".to_owned(),
                        decision: ApprovalDecision::Pending,
                    },
                },
            }),
            EventDisposition::Applied
        );
        assert_eq!(session.state, AgentState::Waiting);
        assert_eq!(
            session.apply(&AgentEvent {
                event_id: "event_3".to_owned(),
                session_id: "agent_1".to_owned(),
                sequence: Some(3),
                kind: AgentEventKind::ApprovalResolved {
                    approval_id: "approval_1".to_owned(),
                    decision: ApprovalDecision::Approved,
                },
            }),
            EventDisposition::Applied
        );
        assert_eq!(session.state, AgentState::Running);
        assert_eq!(
            session.apply(&AgentEvent {
                event_id: "event_4".to_owned(),
                session_id: "agent_1".to_owned(),
                sequence: Some(4),
                kind: AgentEventKind::FileChanged {
                    change: FileChange {
                        path: "src/main.rs".to_owned(),
                        before_hash: None,
                        after_hash: Some("hash".to_owned()),
                    },
                },
            }),
            EventDisposition::Applied
        );
        assert_eq!(session.file_changes.len(), 1);
    }
}
