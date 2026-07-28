//! Provider-neutral session orchestration.

use super::model::ApprovalDecision;
use super::model::{AgentEvent, AgentSession, EventDisposition, SessionId, StartAgentSession};
use super::provider::{AgentProvider, ProviderError};
use std::collections::BTreeMap;

#[derive(Debug)]
pub struct SessionStore<P> {
    provider: P,
    sessions: BTreeMap<SessionId, AgentSession>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionError {
    NotFound,
    Provider(ProviderError),
    InvalidRequest,
    InvalidState,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PumpReport {
    pub applied: usize,
    pub duplicate: usize,
    pub stale: usize,
    pub rejected: usize,
}

impl<P: AgentProvider> SessionStore<P> {
    #[must_use]
    pub fn new(provider: P) -> Self {
        Self {
            provider,
            sessions: BTreeMap::new(),
        }
    }

    pub fn start(&mut self, mut request: StartAgentSession) -> Result<SessionId, SessionError> {
        request
            .profile
            .validate()
            .map_err(|_| SessionError::InvalidRequest)?;
        if request.session_id.trim().is_empty() {
            request.session_id = format!("agent_{}", ulid::Ulid::new());
        }
        if self.sessions.contains_key(&request.session_id) {
            return Err(SessionError::InvalidRequest);
        }
        let descriptor = self.provider.descriptor();
        if descriptor.provider != request.profile.provider
            || !descriptor.supports(super::provider::ProviderCapability::Managed)
        {
            return Err(SessionError::Provider(ProviderError::UnsupportedProvider));
        }
        let _handle = self
            .provider
            .start(&request)
            .map_err(SessionError::Provider)?;
        let mut session = AgentSession::new(&request);
        session.start().map_err(|_| SessionError::InvalidState)?;
        self.sessions.insert(request.session_id.clone(), session);
        self.pump(&request.session_id)?;
        Ok(request.session_id)
    }

    pub fn session(&self, session_id: &str) -> Result<&AgentSession, SessionError> {
        self.sessions.get(session_id).ok_or(SessionError::NotFound)
    }

    pub fn sessions(&self) -> impl Iterator<Item = &AgentSession> {
        self.sessions.values()
    }

    pub fn send_message(
        &mut self,
        session_id: &str,
        message: &str,
    ) -> Result<PumpReport, SessionError> {
        self.session(session_id)?;
        self.provider
            .send_message(session_id, message)
            .map_err(SessionError::Provider)?;
        self.pump(session_id)
    }

    pub fn cancel(&mut self, session_id: &str) -> Result<PumpReport, SessionError> {
        self.sessions
            .get_mut(session_id)
            .ok_or(SessionError::NotFound)?
            .request_cancel()
            .map_err(|_| SessionError::InvalidState)?;
        self.provider
            .cancel(session_id)
            .map_err(SessionError::Provider)?;
        self.pump(session_id)
    }

    pub fn approve(
        &mut self,
        session_id: &str,
        approval_id: &str,
        decision: ApprovalDecision,
    ) -> Result<PumpReport, SessionError> {
        self.session(session_id)?;
        self.provider
            .approve(session_id, approval_id, decision)
            .map_err(SessionError::Provider)?;
        self.pump(session_id)
    }

    pub fn resume(&mut self, session_id: &str) -> Result<PumpReport, SessionError> {
        self.sessions
            .get_mut(session_id)
            .ok_or(SessionError::NotFound)?
            .resume()
            .map_err(|_| SessionError::InvalidState)?;
        self.provider
            .resume(session_id)
            .map_err(SessionError::Provider)?;
        self.pump(session_id)
    }

    pub fn pump(&mut self, session_id: &str) -> Result<PumpReport, SessionError> {
        let events = self
            .provider
            .drain_events(session_id)
            .map_err(SessionError::Provider)?;
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or(SessionError::NotFound)?;
        let mut report = PumpReport::default();
        for event in events {
            match session.apply(&event) {
                EventDisposition::Applied => report.applied += 1,
                EventDisposition::Duplicate => report.duplicate += 1,
                EventDisposition::Stale => report.stale += 1,
                EventDisposition::Rejected(_) => report.rejected += 1,
            }
        }
        Ok(report)
    }

    pub fn inject(&mut self, event: AgentEvent) -> Result<EventDisposition, SessionError> {
        let session = self
            .sessions
            .get_mut(&event.session_id)
            .ok_or(SessionError::NotFound)?;
        Ok(session.apply(&event))
    }

    pub fn provider(&self) -> &P {
        &self.provider
    }

    pub fn provider_mut(&mut self) -> &mut P {
        &mut self.provider
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::model::{
        AgentMode, AgentProfile, ApprovalPolicy, ProjectRoots, ProviderKind, SandboxMode,
        resolve_roots,
    };
    use crate::agents::provider::MockProvider;

    fn request() -> StartAgentSession {
        StartAgentSession {
            session_id: "agent_store".to_owned(),
            workspace_id: "ws_store".to_owned(),
            profile: AgentProfile {
                id: "profile".to_owned(),
                provider: ProviderKind::Codex,
                mode: AgentMode::Managed,
                model: None,
                reasoning: None,
                context_budget: 100,
                sandbox: SandboxMode::ReadOnly,
                approval_policy: ApprovalPolicy::OnRequest,
                mcp_tools: Vec::new(),
            },
            packet_id: "packet_store".to_owned(),
            objective: "check".to_owned(),
            roots: resolve_roots(
                ProjectRoots {
                    project_id: "primary".to_owned(),
                    readable_roots: vec![".".to_owned()],
                    writable_roots: vec![".".to_owned()],
                },
                &[],
                None,
            )
            .expect("roots"),
        }
    }

    #[test]
    fn starts_and_cancels_through_provider_events() {
        let mut store = SessionStore::new(MockProvider::new());
        store.start(request()).expect("start");
        assert_eq!(
            store.session("agent_store").expect("session").state,
            super::super::model::AgentState::Running
        );
        store.cancel("agent_store").expect("cancel");
        assert_eq!(
            store.session("agent_store").expect("session").state,
            super::super::model::AgentState::Completed
        );
    }
}
