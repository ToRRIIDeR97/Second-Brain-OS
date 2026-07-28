//! Provider boundary and deterministic mock used before native process wiring.

use super::model::{
    AgentEvent, AgentEventKind, AgentMode, ApprovalDecision, SessionId, StartAgentSession,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderCapability {
    Managed,
    StructuredEvents,
    Approvals,
    Resume,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub provider: super::model::ProviderKind,
    pub protocol_version: u32,
    pub capabilities: Vec<ProviderCapability>,
    pub visible_fallback: bool,
}

impl ProviderDescriptor {
    #[must_use]
    pub fn supports(&self, capability: ProviderCapability) -> bool {
        self.capabilities.contains(&capability)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSessionHandle {
    pub provider_session_id: SessionId,
    pub protocol_version: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProviderError {
    UnsupportedProvider,
    UnsupportedProtocol { expected: u32, actual: u32 },
    NotFound,
    NotSupported(&'static str),
    AuthenticationRequired,
    InvalidRequest(String),
    Protocol(String),
}

pub trait AgentProvider {
    fn descriptor(&self) -> ProviderDescriptor;
    fn start(
        &mut self,
        request: &StartAgentSession,
    ) -> Result<ProviderSessionHandle, ProviderError>;
    fn send_message(&mut self, session_id: &str, message: &str) -> Result<(), ProviderError>;
    fn cancel(&mut self, session_id: &str) -> Result<(), ProviderError>;
    fn approve(
        &mut self,
        session_id: &str,
        approval_id: &str,
        decision: ApprovalDecision,
    ) -> Result<(), ProviderError>;
    fn resume(&mut self, session_id: &str) -> Result<(), ProviderError>;
    fn drain_events(&mut self, session_id: &str) -> Result<Vec<AgentEvent>, ProviderError>;
}

#[derive(Debug)]
struct MockSession {
    next_sequence: u64,
    events: VecDeque<AgentEvent>,
}

/// In-memory provider for lifecycle tests. It emits only normalized events;
/// provider JSON never reaches the session model.
#[derive(Debug)]
pub struct MockProvider {
    descriptor: ProviderDescriptor,
    sessions: BTreeMap<SessionId, MockSession>,
}

impl Default for MockProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl MockProvider {
    #[must_use]
    pub fn new() -> Self {
        Self {
            descriptor: ProviderDescriptor {
                provider: super::model::ProviderKind::Codex,
                protocol_version: 1,
                capabilities: vec![
                    ProviderCapability::Managed,
                    ProviderCapability::StructuredEvents,
                    ProviderCapability::Approvals,
                    ProviderCapability::Resume,
                ],
                visible_fallback: true,
            },
            sessions: BTreeMap::new(),
        }
    }

    pub fn emit(&mut self, session_id: &str, kind: AgentEventKind) -> Result<(), ProviderError> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or(ProviderError::NotFound)?;
        let sequence = session.next_sequence;
        session.next_sequence = session.next_sequence.saturating_add(1);
        session.events.push_back(AgentEvent {
            event_id: format!("mock_{session_id}_{sequence}"),
            session_id: session_id.to_owned(),
            sequence: Some(sequence),
            kind,
        });
        Ok(())
    }
}

impl AgentProvider for MockProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        self.descriptor.clone()
    }

    fn start(
        &mut self,
        request: &StartAgentSession,
    ) -> Result<ProviderSessionHandle, ProviderError> {
        request
            .profile
            .validate()
            .map_err(|_| ProviderError::InvalidRequest("profile".to_owned()))?;
        if request.profile.mode != AgentMode::Managed
            || request.profile.provider != self.descriptor.provider
        {
            return Err(ProviderError::UnsupportedProvider);
        }
        if self.sessions.contains_key(&request.session_id) {
            return Err(ProviderError::InvalidRequest(
                "duplicate session".to_owned(),
            ));
        }
        self.sessions.insert(
            request.session_id.clone(),
            MockSession {
                next_sequence: 1,
                events: VecDeque::new(),
            },
        );
        self.emit(&request.session_id, AgentEventKind::Started)?;
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
        if approval_id.trim().is_empty() {
            return Err(ProviderError::InvalidRequest("approval".to_owned()));
        }
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
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or(ProviderError::NotFound)?;
        Ok(session.events.drain(..).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::model::{
        AgentId, AgentProfile, ApprovalPolicy, ProviderKind, ResolvedRoots, SandboxMode, ScopedRoot,
    };

    fn request() -> StartAgentSession {
        StartAgentSession {
            session_id: "agent_mock".to_owned(),
            workspace_id: "ws_mock".to_owned(),
            profile: AgentProfile {
                id: AgentId::from("test"),
                provider: ProviderKind::Codex,
                mode: AgentMode::Managed,
                model: None,
                reasoning: None,
                context_budget: 1,
                sandbox: SandboxMode::ReadOnly,
                approval_policy: ApprovalPolicy::OnRequest,
                mcp_tools: Vec::new(),
            },
            packet_id: "packet_mock".to_owned(),
            objective: "test".to_owned(),
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
    fn mock_lifecycle_is_recordable_and_bounded() {
        let mut provider = MockProvider::new();
        provider.start(&request()).expect("start");
        provider
            .send_message("agent_mock", "hello")
            .expect("message");
        provider.cancel("agent_mock").expect("cancel");
        let events = provider.drain_events("agent_mock").expect("events");
        assert_eq!(events.len(), 3);
        assert!(
            events
                .windows(2)
                .all(|pair| pair[0].sequence < pair[1].sequence)
        );
    }
}
