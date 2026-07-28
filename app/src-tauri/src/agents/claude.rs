//! Claude capability detection and optional documented structured adapter.

use super::model::{
    AgentEvent, AgentEventKind, AgentMode, ApprovalDecision, ApprovalRequest, FileChange,
    ProviderKind, StartAgentSession,
};
use super::provider::{
    AgentProvider, ProviderCapability, ProviderDescriptor, ProviderError, ProviderSessionHandle,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, VecDeque};

pub const CLAUDE_STRUCTURED_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCapabilityProbe {
    pub binary_available: bool,
    pub structured_output_available: bool,
    pub structured_schema_version: Option<u32>,
    pub resume_supported: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeLaunchMode {
    VisibleFallback,
    Managed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCapabilities {
    pub launch_mode: ClaudeLaunchMode,
    pub managed: bool,
    pub resume: bool,
    pub reason: Option<String>,
}

/// Capability detection is explicit. There is no PTY scraping fallback for
/// managed behavior; unsupported structured output remains visible mode.
#[must_use]
pub fn detect_capabilities(
    managed_feature_enabled: bool,
    probe: &ClaudeCapabilityProbe,
) -> ClaudeCapabilities {
    let stable_schema = probe.structured_schema_version == Some(CLAUDE_STRUCTURED_SCHEMA_VERSION);
    if managed_feature_enabled
        && probe.binary_available
        && probe.structured_output_available
        && stable_schema
    {
        ClaudeCapabilities {
            launch_mode: ClaudeLaunchMode::Managed,
            managed: true,
            resume: probe.resume_supported,
            reason: None,
        }
    } else {
        let reason = if !probe.binary_available {
            "Claude CLI is not installed"
        } else if !managed_feature_enabled {
            "managed Claude is disabled"
        } else if !probe.structured_output_available {
            "Claude structured output is unavailable"
        } else {
            "Claude structured output schema is unsupported"
        };
        ClaudeCapabilities {
            launch_mode: ClaudeLaunchMode::VisibleFallback,
            managed: false,
            resume: false,
            reason: Some(reason.to_owned()),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ClaudeEventAdapter;

impl ClaudeEventAdapter {
    pub fn parse_line(&self, session_id: &str, line: &str) -> Result<AgentEvent, ProviderError> {
        let value: Value = serde_json::from_str(line)
            .map_err(|error| ProviderError::Protocol(format!("invalid Claude event: {error}")))?;
        let object = value
            .as_object()
            .ok_or_else(|| ProviderError::Protocol("event must be an object".to_owned()))?;
        let schema = object
            .get("schema_version")
            .or_else(|| object.get("schemaVersion"))
            .and_then(Value::as_u64)
            .ok_or_else(|| ProviderError::Protocol("Claude schema version missing".to_owned()))?;
        if schema != u64::from(CLAUDE_STRUCTURED_SCHEMA_VERSION) {
            return Err(ProviderError::UnsupportedProtocol {
                expected: CLAUDE_STRUCTURED_SCHEMA_VERSION,
                actual: schema as u32,
            });
        }
        let event_session = string_field(object, &["session_id", "sessionId"]);
        if event_session.is_some_and(|id| id != session_id) {
            return Err(ProviderError::Protocol("session mismatch".to_owned()));
        }
        let event_type = string_field(object, &["type", "event_type", "eventType"])
            .ok_or_else(|| ProviderError::Protocol("event type missing".to_owned()))?;
        if event_type.starts_with("reasoning") || event_type.contains("hidden") {
            return Err(ProviderError::Protocol(
                "hidden reasoning is not a supported event".to_owned(),
            ));
        }
        let event_id = string_field(object, &["event_id", "eventId", "id"])
            .unwrap_or("claude_event")
            .to_owned();
        let sequence = object
            .get("sequence")
            .or_else(|| object.get("seq"))
            .and_then(Value::as_u64);
        let kind = match event_type {
            "session.started" => AgentEventKind::Started,
            "assistant.text" => AgentEventKind::AssistantText {
                text: string_field(object, &["text", "content"])
                    .unwrap_or_default()
                    .to_owned(),
            },
            "tool.started" => AgentEventKind::ToolStarted {
                call_id: string_field(object, &["call_id", "callId"])
                    .unwrap_or("unknown")
                    .to_owned(),
                name: string_field(object, &["name", "tool"])
                    .unwrap_or("unknown")
                    .to_owned(),
            },
            "tool.finished" => AgentEventKind::ToolFinished {
                call_id: string_field(object, &["call_id", "callId"])
                    .unwrap_or("unknown")
                    .to_owned(),
                success: object
                    .get("success")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            },
            "approval.requested" => AgentEventKind::ApprovalRequested {
                request: ApprovalRequest {
                    approval_id: string_field(object, &["approval_id", "approvalId"])
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
            "file.changed" => AgentEventKind::FileChanged {
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
            "session.completed" => AgentEventKind::Completed,
            "session.canceled" | "session.cancelled" => AgentEventKind::Canceled,
            "session.failed" => AgentEventKind::Failed {
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
                    "unsupported Claude event {event_type}"
                )));
            }
        };
        Ok(AgentEvent {
            event_id,
            session_id: session_id.to_owned(),
            sequence,
            kind,
        })
    }
}

fn string_field<'a>(object: &'a serde_json::Map<String, Value>, names: &[&str]) -> Option<&'a str> {
    names
        .iter()
        .find_map(|name| object.get(*name).and_then(Value::as_str))
}

/// Optional managed adapter. A native Claude process can replace the queue
/// without changing the capability contract or normalized event model.
pub struct StructuredClaudeProvider {
    capabilities: ClaudeCapabilities,
    recording: String,
    sessions: BTreeMap<String, VecDeque<AgentEvent>>,
    adapter: ClaudeEventAdapter,
}

impl StructuredClaudeProvider {
    pub fn new(
        capabilities: ClaudeCapabilities,
        recording: impl Into<String>,
    ) -> Result<Self, ProviderError> {
        if !capabilities.managed {
            return Err(ProviderError::NotSupported("managed Claude"));
        }
        Ok(Self {
            capabilities,
            recording: recording.into(),
            sessions: BTreeMap::new(),
            adapter: ClaudeEventAdapter,
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
            event_id: format!("claude_control_{next}"),
            session_id: session_id.to_owned(),
            sequence: Some(next),
            kind,
        });
        Ok(())
    }
}

impl AgentProvider for StructuredClaudeProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        let mut capabilities = vec![
            ProviderCapability::Managed,
            ProviderCapability::StructuredEvents,
            ProviderCapability::Approvals,
        ];
        if self.capabilities.resume {
            capabilities.push(ProviderCapability::Resume);
        }
        ProviderDescriptor {
            provider: ProviderKind::Claude,
            protocol_version: CLAUDE_STRUCTURED_SCHEMA_VERSION,
            capabilities,
            visible_fallback: true,
        }
    }

    fn start(
        &mut self,
        request: &StartAgentSession,
    ) -> Result<ProviderSessionHandle, ProviderError> {
        if request.profile.provider != ProviderKind::Claude
            || request.profile.mode != AgentMode::Managed
        {
            return Err(ProviderError::UnsupportedProvider);
        }
        if self.sessions.contains_key(&request.session_id) {
            return Err(ProviderError::InvalidRequest(
                "duplicate session".to_owned(),
            ));
        }
        let mut events = VecDeque::new();
        for line in self
            .recording
            .lines()
            .filter(|line| !line.trim().is_empty())
        {
            events.push_back(self.adapter.parse_line(&request.session_id, line)?);
        }
        self.sessions.insert(request.session_id.clone(), events);
        Ok(ProviderSessionHandle {
            provider_session_id: request.session_id.clone(),
            protocol_version: CLAUDE_STRUCTURED_SCHEMA_VERSION,
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
        if !self.capabilities.resume {
            return Err(ProviderError::NotSupported("Claude resume"));
        }
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

    #[test]
    fn unsupported_capability_falls_back_visibly() {
        let capabilities = detect_capabilities(
            true,
            &ClaudeCapabilityProbe {
                binary_available: true,
                structured_output_available: false,
                structured_schema_version: None,
                resume_supported: false,
            },
        );
        assert_eq!(capabilities.launch_mode, ClaudeLaunchMode::VisibleFallback);
        assert!(!capabilities.managed);
        assert!(capabilities.reason.is_some());
    }

    #[test]
    fn structured_parser_requires_documented_schema() {
        let adapter = ClaudeEventAdapter;
        let line = r#"{"schema_version":1,"type":"assistant.text","event_id":"e1","sequence":1,"text":"hi"}"#;
        let event = adapter.parse_line("agent", line).expect("event");
        assert!(matches!(event.kind, AgentEventKind::AssistantText { .. }));
        assert!(
            adapter
                .parse_line("agent", r#"{"type":"assistant.text"}"#)
                .is_err()
        );
    }
}
