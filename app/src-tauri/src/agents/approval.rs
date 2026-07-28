//! Pure approval policy and capability checks.
//!
//! This module deliberately has no database or filesystem dependency.  The
//! application gateway can persist the returned records later, while keeping
//! authorization a fail-closed, side-effect-free decision.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

pub const APPROVAL_CONTRACT: &str = "approval";
pub const APPROVAL_VERSION: u32 = 1;
pub const DEFAULT_TTL_SECONDS: u64 = 300;

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskClass {
    Read,
    LocalReversibleWrite,
    LocalDestructive,
    ExternalPrivateWrite,
    ExternalParticipantWrite,
    SecurityBoundaryChange,
}

impl RiskClass {
    #[must_use]
    pub const fn requires_confirmation(self) -> bool {
        !matches!(self, Self::Read)
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalActor {
    User,
    Agent,
    Provider,
    System,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Pending,
    Approved,
    Denied,
    Expired,
    Canceled,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub actor: ApprovalActor,
    pub session_id: String,
    pub workspace_id: String,
    pub target: String,
    pub capability: String,
    pub policy_revision: u64,
    pub write: bool,
    pub reversible: bool,
    pub external_side_effect: bool,
    pub destructive: bool,
    pub participant_facing: bool,
    pub cross_workspace: bool,
    pub security_boundary_change: bool,
    pub sensitive: bool,
    /// Logical epoch seconds.  The application adapter maps its UTC clock to
    /// this value; a missing expiry receives [`DEFAULT_TTL_SECONDS`].
    pub expires_at: Option<u64>,
}

impl ApprovalRequest {
    #[must_use]
    pub fn read(
        actor: ApprovalActor,
        session_id: impl Into<String>,
        workspace_id: impl Into<String>,
        target: impl Into<String>,
        capability: impl Into<String>,
        policy_revision: u64,
    ) -> Self {
        Self {
            actor,
            session_id: session_id.into(),
            workspace_id: workspace_id.into(),
            target: target.into(),
            capability: capability.into(),
            policy_revision,
            write: false,
            reversible: true,
            external_side_effect: false,
            destructive: false,
            participant_facing: false,
            cross_workspace: false,
            security_boundary_change: false,
            sensitive: false,
            expires_at: None,
        }
    }

    #[must_use]
    pub fn write(
        actor: ApprovalActor,
        session_id: impl Into<String>,
        workspace_id: impl Into<String>,
        target: impl Into<String>,
        capability: impl Into<String>,
        policy_revision: u64,
    ) -> Self {
        Self {
            write: true,
            reversible: true,
            ..Self::read(
                actor,
                session_id,
                workspace_id,
                target,
                capability,
                policy_revision,
            )
        }
    }

    #[must_use]
    pub fn risk_class(&self) -> RiskClass {
        classify(self)
    }
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalPolicy {
    pub revision: u64,
    pub allowed_capabilities: BTreeSet<String>,
    pub readable_roots: Vec<String>,
    pub writable_roots: Vec<String>,
    pub denied_read_roots: Vec<String>,
    pub denied_write_roots: Vec<String>,
    pub allow_cross_workspace: bool,
    pub allow_sensitive_read: bool,
}

impl Default for ApprovalPolicy {
    fn default() -> Self {
        Self {
            revision: 1,
            allowed_capabilities: BTreeSet::new(),
            readable_roots: Vec::new(),
            writable_roots: Vec::new(),
            denied_read_roots: Vec::new(),
            denied_write_roots: Vec::new(),
            allow_cross_workspace: false,
            allow_sensitive_read: false,
        }
    }
}

impl ApprovalPolicy {
    #[must_use]
    pub fn allows(&self, request: &ApprovalRequest) -> bool {
        if !self.allowed_capabilities.contains(&request.capability)
            || (request.cross_workspace && !self.allow_cross_workspace)
            || (request.sensitive && !request.write && !self.allow_sensitive_read)
        {
            return false;
        }

        if request.external_side_effect {
            return true;
        }

        let roots = if request.write {
            &self.writable_roots
        } else {
            &self.readable_roots
        };
        let denied = if request.write {
            &self.denied_write_roots
        } else {
            &self.denied_read_roots
        };
        valid_relative(&request.target)
            && roots.iter().any(|root| path_within(&request.target, root))
            && !denied
                .iter()
                .any(|pattern| path_matches(&request.target, pattern))
    }
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRecord {
    pub contract: String,
    pub version: u32,
    pub approval_id: String,
    pub risk_class: RiskClass,
    pub actor: ApprovalActor,
    pub session_id: String,
    pub workspace_id: String,
    pub target: String,
    pub capability: String,
    pub reversible: bool,
    pub external_side_effect: bool,
    pub destructive: bool,
    pub participant_facing: bool,
    pub cross_workspace: bool,
    pub security_boundary_change: bool,
    pub sensitive: bool,
    pub decision: Decision,
    pub expires_at: u64,
    pub policy_revision: u64,
    pub audit_event_id: String,
    pub revoked: bool,
    pub used: bool,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct AuthorizationGrant {
    pub approval_id: String,
    pub actor: ApprovalActor,
    pub session_id: String,
    pub workspace_id: String,
    pub target: String,
    pub capability: String,
    pub policy_revision: u64,
}

#[derive(Debug, Error, Clone, Eq, PartialEq)]
pub enum ApprovalError {
    #[error("approval policy is unavailable for this workspace")]
    PolicyUnavailable,
    #[error("approval policy revision mismatch (expected {expected}, received {received})")]
    PolicyRevisionMismatch { expected: u64, received: u64 },
    #[error("approval policy revision must increase")]
    PolicyRevisionConflict,
    #[error("approval action is invalid: {0}")]
    InvalidAction(&'static str),
    #[error("approval action is denied by policy")]
    PolicyDenied,
    #[error("approval expires at or before the current time")]
    AlreadyExpired,
    #[error("approval was not found")]
    NotFound,
    #[error("approval already has a final decision")]
    AlreadyDecided,
    #[error("approval decision is invalid")]
    InvalidDecision,
    #[error("approval is pending")]
    Pending,
    #[error("approval was denied")]
    Denied,
    #[error("approval has expired")]
    Expired,
    #[error("approval was canceled or revoked")]
    Revoked,
    #[error("approval has already been consumed")]
    Replayed,
    #[error("approval scope does not match the requested action")]
    ScopeMismatch,
    #[error("approval policy changed after the approval was issued")]
    PolicyChanged { expected: u64, actual: u64 },
}

#[derive(Debug, Default)]
pub struct ApprovalEngine {
    policies: BTreeMap<String, ApprovalPolicy>,
    approvals: BTreeMap<String, ApprovalRecord>,
    next_id: u64,
}

impl ApprovalEngine {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Replace a policy only with a strictly newer revision.  Every approval
    /// bound to the old revision is canceled and revoked; this is deliberately
    /// conservative because a downgrade cannot safely preserve old grants.
    pub fn set_policy(
        &mut self,
        workspace_id: impl Into<String>,
        policy: ApprovalPolicy,
    ) -> Result<(), ApprovalError> {
        let workspace_id = workspace_id.into();
        if self
            .policies
            .get(&workspace_id)
            .is_some_and(|current| policy.revision <= current.revision)
        {
            return Err(ApprovalError::PolicyRevisionConflict);
        }
        for approval in self.approvals.values_mut().filter(|approval| {
            approval.workspace_id == workspace_id
                && matches!(approval.decision, Decision::Pending | Decision::Approved)
        }) {
            approval.decision = Decision::Canceled;
            approval.revoked = true;
        }
        self.policies.insert(workspace_id, policy);
        Ok(())
    }

    pub fn revoke_capability(
        &mut self,
        workspace_id: &str,
        capability: &str,
        next_revision: u64,
    ) -> Result<(), ApprovalError> {
        let mut policy = self
            .policies
            .get(workspace_id)
            .cloned()
            .ok_or(ApprovalError::PolicyUnavailable)?;
        policy.revision = next_revision;
        policy.allowed_capabilities.remove(capability);
        self.set_policy(workspace_id, policy)
    }

    #[must_use]
    pub fn policy(&self, workspace_id: &str) -> Option<&ApprovalPolicy> {
        self.policies.get(workspace_id)
    }

    pub fn request(
        &mut self,
        request: ApprovalRequest,
        now: u64,
    ) -> Result<ApprovalRecord, ApprovalError> {
        validate_request(&request)?;
        let policy = self
            .policies
            .get(&request.workspace_id)
            .cloned()
            .ok_or(ApprovalError::PolicyUnavailable)?;
        if request.policy_revision != policy.revision {
            return Err(ApprovalError::PolicyRevisionMismatch {
                expected: policy.revision,
                received: request.policy_revision,
            });
        }
        if !policy.allows(&request) {
            return Err(ApprovalError::PolicyDenied);
        }
        let expires_at = request
            .expires_at
            .unwrap_or_else(|| now.saturating_add(DEFAULT_TTL_SECONDS));
        if expires_at <= now {
            return Err(ApprovalError::AlreadyExpired);
        }

        let risk_class = request.risk_class();
        let record = ApprovalRecord {
            contract: APPROVAL_CONTRACT.to_owned(),
            version: APPROVAL_VERSION,
            approval_id: self.next_token("approval"),
            risk_class,
            actor: request.actor,
            session_id: request.session_id,
            workspace_id: request.workspace_id,
            target: request.target,
            capability: request.capability,
            reversible: request.reversible,
            external_side_effect: request.external_side_effect,
            destructive: request.destructive,
            participant_facing: request.participant_facing,
            cross_workspace: request.cross_workspace,
            security_boundary_change: request.security_boundary_change,
            sensitive: request.sensitive,
            decision: if risk_class.requires_confirmation() {
                Decision::Pending
            } else {
                Decision::Approved
            },
            expires_at,
            policy_revision: request.policy_revision,
            audit_event_id: self.next_token("evt"),
            revoked: false,
            used: false,
        };
        self.approvals
            .insert(record.approval_id.clone(), record.clone());
        Ok(record)
    }

    pub fn decide(
        &mut self,
        approval_id: &str,
        decision: Decision,
        now: u64,
    ) -> Result<ApprovalRecord, ApprovalError> {
        if !matches!(
            decision,
            Decision::Approved | Decision::Denied | Decision::Canceled
        ) {
            return Err(ApprovalError::InvalidDecision);
        }
        self.ensure_current_policy(approval_id)?;
        let record = self
            .approvals
            .get_mut(approval_id)
            .ok_or(ApprovalError::NotFound)?;
        expire_record(record, now);
        if record.revoked {
            return Err(ApprovalError::Revoked);
        }
        if record.decision == Decision::Expired {
            return Err(ApprovalError::Expired);
        }
        if record.decision != Decision::Pending {
            return Err(ApprovalError::AlreadyDecided);
        }
        record.decision = decision;
        Ok(record.clone())
    }

    /// Validate and consume a grant without touching the requested target.
    /// The caller performs the actual mutation only after this succeeds.
    pub fn authorize(
        &mut self,
        approval_id: &str,
        request: &ApprovalRequest,
        now: u64,
    ) -> Result<AuthorizationGrant, ApprovalError> {
        let (workspace_id, approval_revision) = {
            let record = self
                .approvals
                .get(approval_id)
                .ok_or(ApprovalError::NotFound)?;
            (record.workspace_id.clone(), record.policy_revision)
        };
        let policy = self
            .policies
            .get(&workspace_id)
            .cloned()
            .ok_or(ApprovalError::PolicyUnavailable)?;
        if policy.revision != approval_revision {
            if let Some(record) = self.approvals.get_mut(approval_id) {
                record.decision = Decision::Canceled;
                record.revoked = true;
            }
            return Err(ApprovalError::PolicyChanged {
                expected: approval_revision,
                actual: policy.revision,
            });
        }
        if request.policy_revision != policy.revision {
            return Err(ApprovalError::PolicyRevisionMismatch {
                expected: policy.revision,
                received: request.policy_revision,
            });
        }
        if !policy.allows(request) {
            if let Some(record) = self.approvals.get_mut(approval_id) {
                record.decision = Decision::Canceled;
                record.revoked = true;
            }
            return Err(ApprovalError::PolicyDenied);
        }

        let record = self
            .approvals
            .get_mut(approval_id)
            .ok_or(ApprovalError::NotFound)?;
        expire_record(record, now);
        if record.revoked {
            return Err(ApprovalError::Revoked);
        }
        if record.decision == Decision::Expired {
            return Err(ApprovalError::Expired);
        }
        if record.decision == Decision::Pending {
            return Err(ApprovalError::Pending);
        }
        if record.decision == Decision::Denied {
            return Err(ApprovalError::Denied);
        }
        if record.decision == Decision::Canceled {
            return Err(ApprovalError::Revoked);
        }
        if record.used {
            return Err(ApprovalError::Replayed);
        }
        if !scope_matches(record, request) {
            return Err(ApprovalError::ScopeMismatch);
        }
        record.used = true;
        Ok(AuthorizationGrant {
            approval_id: record.approval_id.clone(),
            actor: record.actor,
            session_id: record.session_id.clone(),
            workspace_id: record.workspace_id.clone(),
            target: record.target.clone(),
            capability: record.capability.clone(),
            policy_revision: record.policy_revision,
        })
    }

    pub fn revoke(&mut self, approval_id: &str) -> Result<ApprovalRecord, ApprovalError> {
        let record = self
            .approvals
            .get_mut(approval_id)
            .ok_or(ApprovalError::NotFound)?;
        record.decision = Decision::Canceled;
        record.revoked = true;
        Ok(record.clone())
    }

    pub fn expire(&mut self, now: u64) -> usize {
        let mut expired = 0;
        for record in self.approvals.values_mut() {
            if matches!(record.decision, Decision::Pending | Decision::Approved)
                && now >= record.expires_at
            {
                record.decision = Decision::Expired;
                expired += 1;
            }
        }
        expired
    }

    #[must_use]
    pub fn get(&self, approval_id: &str) -> Option<&ApprovalRecord> {
        self.approvals.get(approval_id)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.approvals.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.approvals.is_empty()
    }

    fn ensure_current_policy(&mut self, approval_id: &str) -> Result<(), ApprovalError> {
        let (workspace_id, approval_revision) = self
            .approvals
            .get(approval_id)
            .map(|record| (record.workspace_id.clone(), record.policy_revision))
            .ok_or(ApprovalError::NotFound)?;
        let current = self
            .policies
            .get(&workspace_id)
            .ok_or(ApprovalError::PolicyUnavailable)?;
        if current.revision != approval_revision {
            if let Some(record) = self.approvals.get_mut(approval_id) {
                record.decision = Decision::Canceled;
                record.revoked = true;
            }
            return Err(ApprovalError::PolicyChanged {
                expected: approval_revision,
                actual: current.revision,
            });
        }
        Ok(())
    }

    fn next_token(&mut self, prefix: &str) -> String {
        self.next_id = self.next_id.saturating_add(1);
        format!("{prefix}_{}", self.next_id)
    }
}

#[must_use]
pub fn classify(request: &ApprovalRequest) -> RiskClass {
    if request.security_boundary_change || request.cross_workspace {
        RiskClass::SecurityBoundaryChange
    } else if request.external_side_effect && request.participant_facing {
        RiskClass::ExternalParticipantWrite
    } else if request.external_side_effect {
        RiskClass::ExternalPrivateWrite
    } else if request.write && (request.destructive || !request.reversible) {
        RiskClass::LocalDestructive
    } else if request.write {
        RiskClass::LocalReversibleWrite
    } else {
        RiskClass::Read
    }
}

fn validate_request(request: &ApprovalRequest) -> Result<(), ApprovalError> {
    for (name, value) in [
        ("session_id", request.session_id.as_str()),
        ("workspace_id", request.workspace_id.as_str()),
        ("target", request.target.as_str()),
        ("capability", request.capability.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(ApprovalError::InvalidAction(name));
        }
    }
    if request.external_side_effect && !request.write {
        return Err(ApprovalError::InvalidAction(
            "external side effects require a write action",
        ));
    }
    if generic_shell_capability(&request.capability) {
        return Err(ApprovalError::PolicyDenied);
    }
    Ok(())
}

fn generic_shell_capability(capability: &str) -> bool {
    capability == "shell"
        || capability.starts_with("shell.")
        || matches!(
            capability,
            "terminal.exec" | "workspace.open_terminal" | "workspace.run_shell"
        )
}

fn scope_matches(record: &ApprovalRecord, request: &ApprovalRequest) -> bool {
    record.actor == request.actor
        && record.session_id == request.session_id
        && record.workspace_id == request.workspace_id
        && record.target == request.target
        && record.capability == request.capability
        && record.reversible == request.reversible
        && record.external_side_effect == request.external_side_effect
        && record.destructive == request.destructive
        && record.participant_facing == request.participant_facing
        && record.cross_workspace == request.cross_workspace
        && record.security_boundary_change == request.security_boundary_change
        && record.sensitive == request.sensitive
        && record.policy_revision == request.policy_revision
        && record.risk_class == request.risk_class()
}

fn expire_record(record: &mut ApprovalRecord, now: u64) {
    if matches!(record.decision, Decision::Pending | Decision::Approved) && now >= record.expires_at
    {
        record.decision = Decision::Expired;
    }
}

fn valid_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.starts_with('\\')
        && !path.contains('\\')
        && !path.contains('\0')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn path_within(path: &str, root: &str) -> bool {
    if root == "." {
        return valid_relative(path);
    }
    let root = root.trim_matches('/');
    valid_relative(path)
        && valid_relative(root)
        && (path == root
            || path.starts_with(root) && path.as_bytes().get(root.len()) == Some(&b'/'))
}

fn path_matches(path: &str, pattern: &str) -> bool {
    let path = path.split('/').collect::<Vec<_>>();
    let pattern = pattern.trim_matches('/').split('/').collect::<Vec<_>>();
    glob_segments(&path, &pattern)
}

fn glob_segments(path: &[&str], pattern: &[&str]) -> bool {
    match pattern.split_first() {
        None => path.is_empty(),
        Some((head, tail)) if *head == "**" => {
            glob_segments(path, tail) || (!path.is_empty() && glob_segments(&path[1..], pattern))
        }
        Some((head, tail)) => {
            !path.is_empty() && wildcard_segment(path[0], head) && glob_segments(&path[1..], tail)
        }
    }
}

fn wildcard_segment(value: &str, pattern: &str) -> bool {
    let mut values = value.chars();
    let mut pattern = pattern.chars().peekable();
    let mut star = false;
    let mut checkpoint = None;
    while let Some(character) = values.next() {
        match pattern.next() {
            Some('*') => {
                star = true;
                checkpoint = Some((values.clone(), pattern.clone()));
            }
            Some(expected) if expected == character => {}
            _ if star => {
                let Some((mut retry_values, retry_pattern)) = checkpoint.clone() else {
                    return false;
                };
                if retry_values.next().is_none() {
                    return false;
                }
                values = retry_values;
                pattern = retry_pattern;
                checkpoint = Some((values.clone(), pattern.clone()));
            }
            _ => return false,
        }
    }
    while pattern.next() == Some('*') {}
    pattern.next().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(revision: u64) -> ApprovalPolicy {
        ApprovalPolicy {
            revision,
            allowed_capabilities: ["workspace.write", "brain.read"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            readable_roots: vec![".".into()],
            writable_roots: vec!["notes".into()],
            denied_read_roots: vec![".env".into()],
            denied_write_roots: vec![".git/**".into()],
            allow_cross_workspace: false,
            allow_sensitive_read: false,
        }
    }

    fn write_request(revision: u64) -> ApprovalRequest {
        ApprovalRequest::write(
            ApprovalActor::Agent,
            "session-1",
            "ws-1",
            "notes/today.md",
            "workspace.write",
            revision,
        )
    }

    #[test]
    fn denied_approval_has_no_record_or_side_effect() {
        let mut engine = ApprovalEngine::new();
        engine
            .set_policy("ws-1", policy(1))
            .expect("initial policy");
        let request = ApprovalRequest::write(
            ApprovalActor::Agent,
            "session-1",
            "ws-1",
            "src/main.rs",
            "workspace.write",
            1,
        );
        assert_eq!(
            engine.request(request, 10),
            Err(ApprovalError::PolicyDenied)
        );
        assert!(engine.is_empty());

        let mut shell = write_request(1);
        shell.capability = "shell.exec".into();
        assert_eq!(engine.request(shell, 10), Err(ApprovalError::PolicyDenied));
        assert!(engine.is_empty());
    }

    #[test]
    fn denied_and_expired_approvals_cannot_authorize() {
        let mut engine = ApprovalEngine::new();
        engine
            .set_policy("ws-1", policy(1))
            .expect("initial policy");
        let mut request = write_request(1);
        request.expires_at = Some(20);
        let pending = engine.request(request.clone(), 10).expect("request");
        assert_eq!(
            engine.decide(&pending.approval_id, Decision::Denied, 11),
            Ok(ApprovalRecord {
                decision: Decision::Denied,
                ..pending.clone()
            })
        );
        assert_eq!(
            engine.authorize(&pending.approval_id, &request, 11),
            Err(ApprovalError::Denied)
        );

        let mut second = write_request(1);
        second.target = "notes/later.md".into();
        second.expires_at = Some(20);
        let expired = engine.request(second.clone(), 10).expect("request");
        assert_eq!(
            engine.authorize(&expired.approval_id, &second, 20),
            Err(ApprovalError::Expired)
        );
    }

    #[test]
    fn approved_grant_is_single_use_and_scope_bound() {
        let mut engine = ApprovalEngine::new();
        engine
            .set_policy("ws-1", policy(1))
            .expect("initial policy");
        let request = write_request(1);
        let approval = engine.request(request.clone(), 10).expect("request");
        engine
            .decide(&approval.approval_id, Decision::Approved, 11)
            .expect("approve");
        let mut altered = request.clone();
        altered.target = "notes/other.md".into();
        assert_eq!(
            engine.authorize(&approval.approval_id, &altered, 11),
            Err(ApprovalError::ScopeMismatch)
        );
        assert!(
            engine
                .authorize(&approval.approval_id, &request, 11)
                .is_ok()
        );
        assert_eq!(
            engine.authorize(&approval.approval_id, &request, 11),
            Err(ApprovalError::Replayed)
        );
        assert_eq!(
            engine.authorize(&approval.approval_id, &altered, 11),
            Err(ApprovalError::Replayed)
        );
    }

    #[test]
    fn policy_downgrade_revokes_old_approval() {
        let mut engine = ApprovalEngine::new();
        engine
            .set_policy("ws-1", policy(1))
            .expect("initial policy");
        let request = write_request(1);
        let approval = engine.request(request.clone(), 10).expect("request");
        engine
            .decide(&approval.approval_id, Decision::Approved, 11)
            .expect("approve");
        let mut downgraded = policy(2);
        downgraded.allowed_capabilities.remove("workspace.write");
        engine.set_policy("ws-1", downgraded).expect("downgrade");
        assert_eq!(
            engine.authorize(&approval.approval_id, &request, 11),
            Err(ApprovalError::PolicyChanged {
                expected: 1,
                actual: 2
            })
        );
        assert!(engine.get(&approval.approval_id).expect("record").revoked);
    }

    #[test]
    fn destructive_and_cross_workspace_actions_require_confirmation() {
        let mut engine = ApprovalEngine::new();
        let mut configured = policy(1);
        configured.allow_cross_workspace = true;
        engine
            .set_policy("ws-1", configured)
            .expect("initial policy");

        let mut destructive = write_request(1);
        destructive.destructive = true;
        destructive.reversible = false;
        let destructive_record = engine.request(destructive, 10).expect("request");
        assert_eq!(destructive_record.risk_class, RiskClass::LocalDestructive);
        assert_eq!(destructive_record.decision, Decision::Pending);

        let mut cross_workspace = write_request(1);
        cross_workspace.cross_workspace = true;
        let cross_record = engine.request(cross_workspace, 10).expect("request");
        assert_eq!(cross_record.risk_class, RiskClass::SecurityBoundaryChange);
        assert_eq!(cross_record.decision, Decision::Pending);
    }

    #[test]
    fn risk_classification_covers_external_and_read_defaults() {
        let mut engine = ApprovalEngine::new();
        let mut configured = policy(1);
        configured
            .allowed_capabilities
            .insert("calendar.write".into());
        engine
            .set_policy("ws-1", configured)
            .expect("initial policy");
        let read = ApprovalRequest::read(
            ApprovalActor::Agent,
            "session-1",
            "ws-1",
            "notes/today.md",
            "brain.read",
            1,
        );
        assert_eq!(
            engine.request(read, 10).expect("read").decision,
            Decision::Approved
        );
        let mut external = ApprovalRequest::write(
            ApprovalActor::Agent,
            "session-1",
            "ws-1",
            "calendar/event-1",
            "calendar.write",
            1,
        );
        external.external_side_effect = true;
        external.participant_facing = true;
        assert_eq!(
            engine.request(external, 10).expect("external").risk_class,
            RiskClass::ExternalParticipantWrite
        );
    }
}
