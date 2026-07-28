//! Codex App Server compatibility boundary and recorded-event adapter.

use super::model::{
    AgentEvent, AgentEventKind, AgentMode, ApprovalDecision, ApprovalRequest, FileChange,
    ProviderKind, StartAgentSession, Usage, ValidationResult,
};
use super::provider::{
    AgentProvider, ProviderCapability, ProviderDescriptor, ProviderError, ProviderSessionHandle,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, VecDeque};

pub const CODEX_PROTOCOL_MIN: u32 = 1;
pub const CODEX_PROTOCOL_MAX: u32 = 1;

pub fn check_protocol(version: u32) -> Result<(), ProviderError> {
    if (CODEX_PROTOCOL_MIN..=CODEX_PROTOCOL_MAX).contains(&version) {
        Ok(())
    } else {
        Err(ProviderError::UnsupportedProtocol {
            expected: CODEX_PROTOCOL_MAX,
            actual: version,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexLaunchPreview {
    pub command: String,
    pub protocol_version: u32,
    pub packet_id: String,
    pub readable_roots: Vec<String>,
    pub writable_roots: Vec<String>,
    pub mcp_config: McpConfigPreview,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigPreview {
    pub action: McpConfigAction,
    pub command: String,
    pub readable_roots: Vec<String>,
    pub writable_roots: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpConfigAction {
    NoChange,
    PreviewCreate,
    PreviewMerge,
}

/// Build a preview only. The caller must show this before writing a
/// user-managed config; this module never overwrites files.
pub fn launch_preview(
    request: &StartAgentSession,
    protocol_version: u32,
    existing_mcp_config: Option<&str>,
    mcp_command: &str,
) -> Result<CodexLaunchPreview, ProviderError> {
    check_protocol(protocol_version)?;
    if request.profile.provider != ProviderKind::Codex || request.profile.mode != AgentMode::Managed
    {
        return Err(ProviderError::UnsupportedProvider);
    }
    if mcp_command.trim().is_empty() || mcp_command.chars().any(char::is_control) {
        return Err(ProviderError::InvalidRequest("mcp command".to_owned()));
    }
    let action = if existing_mcp_config.is_some_and(|config| !config.trim().is_empty()) {
        McpConfigAction::PreviewMerge
    } else {
        McpConfigAction::PreviewCreate
    };
    let readable_roots = request
        .roots
        .readable
        .iter()
        .map(|root| format!("{}:{}", root.project_id, root.relative_path))
        .collect::<Vec<_>>();
    let writable_roots = request
        .roots
        .writable
        .iter()
        .map(|root| format!("{}:{}", root.project_id, root.relative_path))
        .collect::<Vec<_>>();
    Ok(CodexLaunchPreview {
        command: "codex app-server".to_owned(),
        protocol_version,
        packet_id: request.packet_id.clone(),
        readable_roots: readable_roots.clone(),
        writable_roots: writable_roots.clone(),
        mcp_config: McpConfigPreview {
            action,
            command: mcp_command.to_owned(),
            readable_roots,
            writable_roots,
        },
    })
}

#[derive(Clone, Debug, Default)]
pub struct CodexEventAdapter;

impl CodexEventAdapter {
    pub fn parse_line(
        &self,
        session_id: &str,
        line: &str,
    ) -> Result<Option<AgentEvent>, ProviderError> {
        let value: Value = serde_json::from_str(line)
            .map_err(|error| ProviderError::Protocol(format!("invalid event: {error}")))?;
        let object = value
            .as_object()
            .ok_or_else(|| ProviderError::Protocol("event must be an object".to_owned()))?;
        let event_type = string_field(object, &["type", "event_type", "eventType"])
            .ok_or_else(|| ProviderError::Protocol("event type missing".to_owned()))?;
        // Private reasoning is deliberately ignored, not persisted or exposed.
        if event_type.starts_with("reasoning") || event_type.contains("hidden") {
            return Ok(None);
        }
        let event_session = string_field(object, &["session_id", "sessionId"]);
        if event_session.is_some_and(|id| id != session_id) {
            return Err(ProviderError::Protocol("session mismatch".to_owned()));
        }
        let sequence = number_field(object, &["sequence", "seq"]);
        let event_id = string_field(object, &["event_id", "eventId", "id"])
            .map(str::to_owned)
            .unwrap_or_else(|| format!("codex_{}", sequence.unwrap_or(0)));
        let kind = match event_type {
            "session.started" | "turn.started" => AgentEventKind::Started,
            "assistant.delta" | "message.delta" | "assistant.message" => {
                AgentEventKind::AssistantText {
                    text: string_field(object, &["text", "delta", "content"])
                        .unwrap_or_default()
                        .to_owned(),
                }
            }
            "tool.started" | "tool.call.started" => AgentEventKind::ToolStarted {
                call_id: string_field(object, &["call_id", "callId", "id"])
                    .unwrap_or("unknown")
                    .to_owned(),
                name: string_field(object, &["name", "tool"])
                    .unwrap_or("unknown")
                    .to_owned(),
            },
            "tool.finished" | "tool.call.finished" => AgentEventKind::ToolFinished {
                call_id: string_field(object, &["call_id", "callId", "id"])
                    .unwrap_or("unknown")
                    .to_owned(),
                success: object
                    .get("success")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            },
            "approval.requested" | "approval.required" => AgentEventKind::ApprovalRequested {
                request: ApprovalRequest {
                    approval_id: string_field(object, &["approval_id", "approvalId", "id"])
                        .unwrap_or("approval_unknown")
                        .to_owned(),
                    risk_class: string_field(object, &["risk_class", "riskClass"])
                        .unwrap_or("local_reversible_write")
                        .to_owned(),
                    summary: string_field(object, &["summary", "message"])
                        .unwrap_or("Approval required")
                        .to_owned(),
                    target: string_field(object, &["target", "path"])
                        .unwrap_or("workspace")
                        .to_owned(),
                    decision: super::model::ApprovalDecision::Pending,
                },
            },
            "file.changed" | "patch.applied" => AgentEventKind::FileChanged {
                change: FileChange {
                    path: string_field(object, &["path", "relative_path", "relativePath"])
                        .ok_or_else(|| ProviderError::Protocol("file path missing".to_owned()))?
                        .to_owned(),
                    before_hash: string_field(object, &["before_hash", "beforeHash"])
                        .map(str::to_owned),
                    after_hash: string_field(object, &["after_hash", "afterHash"])
                        .map(str::to_owned),
                },
            },
            "validation.completed" | "validation.finished" => AgentEventKind::ValidationCompleted {
                result: ValidationResult {
                    validation_id: string_field(object, &["validation_id", "validationId"])
                        .unwrap_or("validation_unknown")
                        .to_owned(),
                    command_id: string_field(object, &["command_id", "commandId"])
                        .unwrap_or("configured")
                        .to_owned(),
                    passed: object
                        .get("passed")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    summary: string_field(object, &["summary", "message"])
                        .unwrap_or_default()
                        .to_owned(),
                },
            },
            "usage.updated" | "usage" => AgentEventKind::Usage {
                usage: Usage {
                    input_tokens: number_field(object, &["input_tokens", "inputTokens"]),
                    output_tokens: number_field(object, &["output_tokens", "outputTokens"]),
                },
            },
            "session.completed" | "turn.completed" => AgentEventKind::Completed,
            "session.canceled" | "session.cancelled" => AgentEventKind::Canceled,
            "session.recoverable" | "process.crashed" => AgentEventKind::Recoverable {
                reason: string_field(object, &["reason", "message"])
                    .unwrap_or("provider process stopped")
                    .to_owned(),
            },
            "session.failed" | "error" => AgentEventKind::Failed {
                code: string_field(object, &["code", "error_code", "errorCode"])
                    .unwrap_or("provider.failed")
                    .to_owned(),
                message: string_field(object, &["message", "error"])
                    .unwrap_or("Provider failed")
                    .to_owned(),
                retryable: object
                    .get("retryable")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            },
            _ => {
                return Err(ProviderError::Protocol(format!(
                    "unsupported Codex event {event_type}"
                )));
            }
        };
        Ok(Some(AgentEvent {
            event_id,
            session_id: session_id.to_owned(),
            sequence,
            kind,
        }))
    }

    pub fn parse_recording(
        &self,
        session_id: &str,
        recording: &str,
    ) -> Result<Vec<AgentEvent>, ProviderError> {
        let mut events = Vec::new();
        for line in recording.lines().filter(|line| !line.trim().is_empty()) {
            if let Some(event) = self.parse_line(session_id, line)? {
                events.push(event);
            }
        }
        Ok(events)
    }
}

fn string_field<'a>(object: &'a serde_json::Map<String, Value>, names: &[&str]) -> Option<&'a str> {
    names
        .iter()
        .find_map(|name| object.get(*name).and_then(Value::as_str))
}

fn number_field(object: &serde_json::Map<String, Value>, names: &[&str]) -> Option<u64> {
    names
        .iter()
        .find_map(|name| object.get(*name).and_then(Value::as_u64))
}

/// Replay a documented JSON-lines recording through the provider trait. Real
/// process supervision can replace this without changing session semantics.
pub struct RecordedCodexProvider {
    descriptor: ProviderDescriptor,
    recording: String,
    sessions: BTreeMap<String, VecDeque<AgentEvent>>,
    adapter: CodexEventAdapter,
}

impl RecordedCodexProvider {
    pub fn new(protocol_version: u32, recording: impl Into<String>) -> Result<Self, ProviderError> {
        check_protocol(protocol_version)?;
        Ok(Self {
            descriptor: ProviderDescriptor {
                provider: ProviderKind::Codex,
                protocol_version,
                capabilities: vec![
                    ProviderCapability::Managed,
                    ProviderCapability::StructuredEvents,
                    ProviderCapability::Approvals,
                    ProviderCapability::Resume,
                ],
                visible_fallback: true,
            },
            recording: recording.into(),
            sessions: BTreeMap::new(),
            adapter: CodexEventAdapter,
        })
    }

    fn emit(&mut self, session_id: &str, kind: AgentEventKind) -> Result<(), ProviderError> {
        let queue = self
            .sessions
            .get_mut(session_id)
            .ok_or(ProviderError::NotFound)?;
        let next = queue
            .back()
            .and_then(|event| event.sequence)
            .unwrap_or(0)
            .saturating_add(1);
        queue.push_back(AgentEvent {
            event_id: format!("codex_control_{next}"),
            session_id: session_id.to_owned(),
            sequence: Some(next),
            kind,
        });
        Ok(())
    }
}

impl AgentProvider for RecordedCodexProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        self.descriptor.clone()
    }

    fn start(
        &mut self,
        request: &StartAgentSession,
    ) -> Result<ProviderSessionHandle, ProviderError> {
        if request.profile.provider != ProviderKind::Codex
            || request.profile.mode != AgentMode::Managed
        {
            return Err(ProviderError::UnsupportedProvider);
        }
        if self.sessions.contains_key(&request.session_id) {
            return Err(ProviderError::InvalidRequest(
                "duplicate session".to_owned(),
            ));
        }
        let events = self
            .adapter
            .parse_recording(&request.session_id, &self.recording)?;
        self.sessions
            .insert(request.session_id.clone(), events.into_iter().collect());
        Ok(ProviderSessionHandle {
            provider_session_id: request.session_id.clone(),
            protocol_version: self.descriptor.protocol_version,
        })
    }

    fn send_message(&mut self, session_id: &str, message: &str) -> Result<(), ProviderError> {
        if message.trim().is_empty() {
            return Err(ProviderError::InvalidRequest("message".to_owned()));
        }
        self.emit(
            session_id,
            AgentEventKind::AssistantText {
                text: message.to_owned(),
            },
        )
    }

    fn cancel(&mut self, session_id: &str) -> Result<(), ProviderError> {
        self.emit(session_id, AgentEventKind::Canceled)
    }

    fn approve(
        &mut self,
        session_id: &str,
        approval_id: &str,
        decision: ApprovalDecision,
    ) -> Result<(), ProviderError> {
        self.emit(
            session_id,
            AgentEventKind::ApprovalResolved {
                approval_id: approval_id.to_owned(),
                decision,
            },
        )
    }

    fn resume(&mut self, session_id: &str) -> Result<(), ProviderError> {
        self.emit(session_id, AgentEventKind::Started)
    }

    fn drain_events(&mut self, session_id: &str) -> Result<Vec<AgentEvent>, ProviderError> {
        self.sessions
            .get_mut(session_id)
            .map(|queue| queue.drain(..).collect())
            .ok_or(ProviderError::NotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::model::{AgentProfile, ApprovalPolicy, ResolvedRoots, ScopedRoot};

    fn request() -> StartAgentSession {
        StartAgentSession {
            session_id: "agent_codex".to_owned(),
            workspace_id: "ws_codex".to_owned(),
            profile: AgentProfile {
                id: "codex".to_owned(),
                provider: ProviderKind::Codex,
                mode: AgentMode::Managed,
                model: None,
                reasoning: None,
                context_budget: 1,
                sandbox: super::super::model::SandboxMode::ReadOnly,
                approval_policy: ApprovalPolicy::OnRequest,
                mcp_tools: Vec::new(),
            },
            packet_id: "packet".to_owned(),
            objective: "Review".to_owned(),
            roots: ResolvedRoots {
                readable: vec![ScopedRoot {
                    project_id: "project".to_owned(),
                    relative_path: ".".to_owned(),
                }],
                writable: Vec::new(),
                writable_project_id: "project".to_owned(),
            },
        }
    }

    #[test]
    fn checks_protocol_and_filters_reasoning() {
        assert!(check_protocol(CODEX_PROTOCOL_MAX).is_ok());
        assert!(check_protocol(CODEX_PROTOCOL_MAX + 1).is_err());
        let recording = r#"
            {"type":"session.started","sequence":1}
            {"type":"reasoning.delta","sequence":2,"text":"secret"}
            {"type":"assistant.delta","sequence":3,"text":"hello"}
        "#;
        let events = CodexEventAdapter
            .parse_recording("agent_codex", recording)
            .expect("events");
        assert_eq!(events.len(), 2);
        assert!(matches!(
            events[1].kind,
            AgentEventKind::AssistantText { .. }
        ));
    }

    #[test]
    fn recorded_provider_replays_normalized_events() {
        let mut provider =
            RecordedCodexProvider::new(1, r#"{"type":"session.started","sequence":1}"#)
                .expect("provider");
        provider.start(&request()).expect("start");
        assert_eq!(
            provider.drain_events("agent_codex").expect("drain").len(),
            1
        );
    }
}
