//! App-owned MCP capability checks.
//!
//! The sidecar carries opaque grants; only this module can issue, narrow, and
//! authorize them. Storage, workspace policy, and tool behavior stay in the app.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Component, Path};

pub const MCP_PROTOCOL_VERSION: u32 = 1;
pub const MAX_CAPABILITY_LIFETIME_SECONDS: i64 = 3_600;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityClaims {
    pub token_id: String,
    pub agent_id: String,
    pub session_id: String,
    pub workspace_id: String,
    pub tools: BTreeSet<String>,
    pub readable_roots: BTreeSet<String>,
    pub writable_roots: BTreeSet<String>,
    pub issued_at: i64,
    pub expires_at: i64,
    pub policy_revision: u64,
    pub protocol_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapabilityRequest<'a> {
    pub agent_id: &'a str,
    pub session_id: &'a str,
    pub workspace_id: &'a str,
    pub tool: &'a str,
    pub relative_path: Option<&'a str>,
    pub write: bool,
    pub policy_revision: u64,
    pub now: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizedCall {
    pub token_id: String,
    pub audit_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityError {
    Invalid,
    Expired,
    Revoked,
    IdentityMismatch,
    ProtocolMismatch,
    PolicyChanged,
    ToolDenied,
    PathDenied,
}

pub struct CapabilityIssuer {
    key: [u8; 32],
    revoked: BTreeSet<String>,
}

impl CapabilityIssuer {
    /// The application lifecycle supplies key material from the platform
    /// credential/randomness adapter; it is never derived from a session ID.
    #[must_use]
    pub fn new(key: [u8; 32]) -> Self {
        Self {
            key,
            revoked: BTreeSet::new(),
        }
    }

    pub fn issue(&self, claims: &CapabilityClaims) -> Result<String, CapabilityError> {
        validate_claims(claims)?;
        let payload = serde_json::to_vec(claims).map_err(|_| CapabilityError::Invalid)?;
        let signature = blake3::keyed_hash(&self.key, &payload);
        Ok(format!("{}.{}", hex(&payload), signature.to_hex()))
    }

    pub fn narrow(
        &self,
        parent_token: &str,
        child: &CapabilityClaims,
    ) -> Result<String, CapabilityError> {
        let parent = self.decode(parent_token)?;
        if child.agent_id != parent.agent_id
            || child.session_id != parent.session_id
            || child.workspace_id != parent.workspace_id
            || child.issued_at < parent.issued_at
            || child.expires_at > parent.expires_at
            || child.policy_revision != parent.policy_revision
            || child.protocol_version != parent.protocol_version
            || !child.tools.is_subset(&parent.tools)
            || !roots_are_narrower(&child.readable_roots, &parent.readable_roots)
            || !roots_are_narrower(&child.writable_roots, &parent.writable_roots)
        {
            return Err(CapabilityError::Invalid);
        }
        self.issue(child)
    }

    pub fn revoke(&mut self, token_id: impl Into<String>) {
        self.revoked.insert(token_id.into());
    }

    pub fn authorize(
        &self,
        token: &str,
        request: &CapabilityRequest<'_>,
    ) -> Result<AuthorizedCall, CapabilityError> {
        let claims = self.decode(token)?;
        if self.revoked.contains(&claims.token_id) {
            return Err(CapabilityError::Revoked);
        }
        if request.now < claims.issued_at || request.now >= claims.expires_at {
            return Err(CapabilityError::Expired);
        }
        if claims.protocol_version != MCP_PROTOCOL_VERSION {
            return Err(CapabilityError::ProtocolMismatch);
        }
        if claims.policy_revision != request.policy_revision {
            return Err(CapabilityError::PolicyChanged);
        }
        if claims.agent_id != request.agent_id
            || claims.session_id != request.session_id
            || claims.workspace_id != request.workspace_id
        {
            return Err(CapabilityError::IdentityMismatch);
        }
        if !claims.tools.contains(request.tool) {
            return Err(CapabilityError::ToolDenied);
        }
        if let Some(path) = request.relative_path {
            let roots = if request.write {
                &claims.writable_roots
            } else {
                &claims.readable_roots
            };
            if !valid_relative(path) || !within_roots(path, roots) {
                return Err(CapabilityError::PathDenied);
            }
        }
        Ok(AuthorizedCall {
            token_id: claims.token_id.clone(),
            audit_id: format!("mcp_{}", claims.token_id),
        })
    }

    fn decode(&self, token: &str) -> Result<CapabilityClaims, CapabilityError> {
        let (payload, signature) = token.split_once('.').ok_or(CapabilityError::Invalid)?;
        let payload = unhex(payload)?;
        let supplied = unhex(signature)?;
        let expected = blake3::keyed_hash(&self.key, &payload);
        if supplied.len() != expected.as_bytes().len()
            || !supplied
                .iter()
                .zip(expected.as_bytes())
                .fold(true, |equal, (left, right)| equal & (left == right))
        {
            return Err(CapabilityError::Invalid);
        }
        serde_json::from_slice(&payload).map_err(|_| CapabilityError::Invalid)
    }
}

fn validate_claims(claims: &CapabilityClaims) -> Result<(), CapabilityError> {
    if claims.token_id.trim().is_empty()
        || claims.agent_id.trim().is_empty()
        || claims.session_id.trim().is_empty()
        || claims.workspace_id.trim().is_empty()
        || claims.protocol_version != MCP_PROTOCOL_VERSION
        || claims.expires_at <= claims.issued_at
        || claims.expires_at - claims.issued_at > MAX_CAPABILITY_LIFETIME_SECONDS
        || claims.tools.is_empty()
        || claims
            .readable_roots
            .iter()
            .chain(&claims.writable_roots)
            .any(|root| root != "." && !valid_relative(root))
    {
        return Err(CapabilityError::Invalid);
    }
    Ok(())
}

fn valid_relative(path: &str) -> bool {
    !path.is_empty()
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn within_roots(path: &str, roots: &BTreeSet<String>) -> bool {
    roots.iter().any(|root| {
        root == "."
            || Path::new(path) == Path::new(root)
            || Path::new(path).starts_with(Path::new(root))
    })
}

fn roots_are_narrower(children: &BTreeSet<String>, parents: &BTreeSet<String>) -> bool {
    children.iter().all(|child| within_roots(child, parents))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(char::from(DIGITS[usize::from(byte >> 4)]));
        result.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    result
}

fn unhex(value: &str) -> Result<Vec<u8>, CapabilityError> {
    if !value.len().is_multiple_of(2) {
        return Err(CapabilityError::Invalid);
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = digit(pair[0])?;
            let low = digit(pair[1])?;
            Ok((high << 4) | low)
        })
        .collect()
}

fn digit(value: u8) -> Result<u8, CapabilityError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(CapabilityError::Invalid),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims() -> CapabilityClaims {
        CapabilityClaims {
            token_id: "token".to_owned(),
            agent_id: "agent".to_owned(),
            session_id: "session".to_owned(),
            workspace_id: "workspace".to_owned(),
            tools: ["brain.search", "workspace.write_text"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            readable_roots: ["notes", "projects"]
                .into_iter()
                .map(str::to_owned)
                .collect(),
            writable_roots: ["notes"].into_iter().map(str::to_owned).collect(),
            issued_at: 100,
            expires_at: 200,
            policy_revision: 3,
            protocol_version: MCP_PROTOCOL_VERSION,
        }
    }

    #[test]
    fn token_is_bound_to_identity_tool_path_expiry_and_policy() {
        let issuer = CapabilityIssuer::new([7; 32]);
        let token = issuer.issue(&claims()).expect("token");
        let mut request = CapabilityRequest {
            agent_id: "agent",
            session_id: "session",
            workspace_id: "workspace",
            tool: "workspace.write_text",
            relative_path: Some("notes/today.md"),
            write: true,
            policy_revision: 3,
            now: 150,
        };
        assert!(issuer.authorize(&token, &request).is_ok());
        request.session_id = "other";
        assert_eq!(
            issuer.authorize(&token, &request),
            Err(CapabilityError::IdentityMismatch)
        );
        request.session_id = "session";
        request.relative_path = Some("projects/secret.md");
        assert_eq!(
            issuer.authorize(&token, &request),
            Err(CapabilityError::PathDenied)
        );
        request.relative_path = Some("notes/today.md");
        request.now = 200;
        assert_eq!(
            issuer.authorize(&token, &request),
            Err(CapabilityError::Expired)
        );
    }

    #[test]
    fn forged_expanded_and_revoked_tokens_fail_closed() {
        let mut issuer = CapabilityIssuer::new([7; 32]);
        let token = issuer.issue(&claims()).expect("token");
        let mut forged = token.clone().into_bytes();
        forged[4] = if forged[4] == b'0' { b'1' } else { b'0' };
        assert!(matches!(
            issuer.decode(&String::from_utf8(forged).expect("utf8")),
            Err(CapabilityError::Invalid)
        ));

        let mut expanded = claims();
        expanded.token_id = "child".to_owned();
        expanded.writable_roots.insert("projects".to_owned());
        assert_eq!(
            issuer.narrow(&token, &expanded),
            Err(CapabilityError::Invalid)
        );

        issuer.revoke("token");
        let request = CapabilityRequest {
            agent_id: "agent",
            session_id: "session",
            workspace_id: "workspace",
            tool: "brain.search",
            relative_path: None,
            write: false,
            policy_revision: 3,
            now: 150,
        };
        assert_eq!(
            issuer.authorize(&token, &request),
            Err(CapabilityError::Revoked)
        );
    }
}
