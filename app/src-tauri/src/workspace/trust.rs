use serde::{Deserialize, Serialize};

use super::manifest::WorkspaceManifest;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    #[default]
    Untrusted,
    TrustedReadOnly,
    Trusted,
    Restricted,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CapabilitySummary {
    pub read: bool,
    pub write: bool,
    pub terminal: bool,
    pub mcp_read: bool,
    pub mcp_write: bool,
    pub external_open: bool,
    pub external_open_requires_approval: bool,
    pub raw_html: bool,
    pub project_configuration: bool,
}

impl TrustLevel {
    #[must_use]
    pub const fn capabilities(self) -> CapabilitySummary {
        match self {
            Self::Untrusted => CapabilitySummary {
                read: true,
                write: false,
                terminal: false,
                mcp_read: true,
                mcp_write: false,
                external_open: false,
                external_open_requires_approval: true,
                raw_html: false,
                project_configuration: false,
            },
            Self::TrustedReadOnly => CapabilitySummary {
                read: true,
                write: false,
                terminal: false,
                mcp_read: true,
                mcp_write: false,
                external_open: false,
                external_open_requires_approval: true,
                raw_html: false,
                project_configuration: false,
            },
            Self::Trusted => CapabilitySummary {
                read: true,
                write: true,
                terminal: true,
                mcp_read: true,
                mcp_write: true,
                external_open: true,
                external_open_requires_approval: false,
                raw_html: true,
                project_configuration: true,
            },
            Self::Restricted => CapabilitySummary {
                read: true,
                write: false,
                terminal: false,
                mcp_read: false,
                mcp_write: false,
                external_open: false,
                external_open_requires_approval: true,
                raw_html: false,
                project_configuration: false,
            },
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ApplicationPolicy {
    pub allow_read: bool,
    pub allow_write: bool,
    pub allow_terminal: bool,
    pub allow_mcp_read: bool,
    pub allow_mcp_write: bool,
    pub allow_external_open: bool,
    pub allow_raw_html: bool,
    pub allow_project_configuration: bool,
    #[serde(default)]
    pub hard_deny_read: Vec<String>,
    #[serde(default)]
    pub hard_deny_write: Vec<String>,
}

impl Default for ApplicationPolicy {
    fn default() -> Self {
        Self {
            allow_read: true,
            allow_write: true,
            allow_terminal: true,
            allow_mcp_read: true,
            allow_mcp_write: true,
            allow_external_open: true,
            allow_raw_html: true,
            allow_project_configuration: true,
            hard_deny_read: vec![".env".into(), ".env.*".into(), "credentials/**".into()],
            hard_deny_write: vec![".git/**".into(), "vendor/**".into()],
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EffectivePolicy {
    pub trust_level: TrustLevel,
    pub capabilities: CapabilitySummary,
    pub readable_roots: Vec<String>,
    pub deny_read: Vec<String>,
    pub writable_roots: Vec<String>,
    pub deny_write: Vec<String>,
    pub policy_generation: u64,
}

impl EffectivePolicy {
    #[must_use]
    pub fn can_read(&self) -> bool {
        self.capabilities.read && !self.readable_roots.is_empty()
    }

    #[must_use]
    pub fn can_write(&self) -> bool {
        self.capabilities.write && !self.writable_roots.is_empty()
    }
}

/// Compute policy by intersection: application controls and hard denies are
/// never broadened by a workspace manifest.  A caller may replace
/// `policy_generation` with the database generation when persisting it.
#[must_use]
pub fn evaluate_policy(
    trust_level: TrustLevel,
    manifest: Option<&WorkspaceManifest>,
    application: &ApplicationPolicy,
) -> EffectivePolicy {
    let trust = trust_level.capabilities();
    let mut capabilities = CapabilitySummary {
        read: trust.read && application.allow_read,
        write: trust.write && application.allow_write,
        terminal: trust.terminal && application.allow_terminal,
        mcp_read: trust.mcp_read && application.allow_mcp_read,
        mcp_write: trust.mcp_write && application.allow_mcp_write,
        external_open: trust.external_open && application.allow_external_open,
        external_open_requires_approval: trust.external_open_requires_approval,
        raw_html: trust.raw_html && application.allow_raw_html,
        project_configuration: trust.project_configuration
            && application.allow_project_configuration,
    };
    if !capabilities.external_open {
        capabilities.external_open_requires_approval = true;
    }

    let (readable_roots, deny_read, writable_roots, deny_write) = manifest
        .map(|manifest| {
            (
                manifest.security.readable.clone(),
                merge_patterns(&application.hard_deny_read, &manifest.security.deny_read),
                if capabilities.write {
                    manifest.security.writable.clone()
                } else {
                    Vec::new()
                },
                merge_patterns(&application.hard_deny_write, &manifest.security.deny_write),
            )
        })
        .unwrap_or_else(|| {
            (
                vec![".".into()],
                application.hard_deny_read.clone(),
                if capabilities.write {
                    vec![".".into()]
                } else {
                    Vec::new()
                },
                application.hard_deny_write.clone(),
            )
        });

    EffectivePolicy {
        trust_level,
        capabilities,
        readable_roots,
        deny_read,
        writable_roots,
        deny_write,
        policy_generation: 0,
    }
}

fn merge_patterns(application: &[String], manifest: &[String]) -> Vec<String> {
    let mut patterns = application.to_vec();
    patterns.extend(manifest.iter().cloned());
    patterns.sort();
    patterns.dedup();
    patterns
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{WorkspaceKind, parse_manifest};

    #[test]
    fn untrusted_policy_is_read_only_and_hides_project_configuration() {
        let policy = evaluate_policy(TrustLevel::Untrusted, None, &ApplicationPolicy::default());
        assert!(policy.can_read());
        assert!(!policy.can_write());
        assert!(!policy.capabilities.terminal);
        assert!(!policy.capabilities.project_configuration);
        assert!(policy.capabilities.external_open_requires_approval);
    }

    #[test]
    fn manifest_roots_can_restrict_but_not_broaden_trust() {
        let manifest = parse_manifest(
            "schema_version: 1\nkind: project\nsecurity:\n  readable: ['src']\n  writable: ['src']\n",
        )
        .expect("manifest");
        let policy = evaluate_policy(
            TrustLevel::TrustedReadOnly,
            Some(&manifest),
            &ApplicationPolicy::default(),
        );
        assert_eq!(policy.readable_roots, vec!["src"]);
        assert!(policy.writable_roots.is_empty());
        assert_eq!(manifest.kind, WorkspaceKind::Project);
    }
}
