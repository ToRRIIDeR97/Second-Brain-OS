use std::fmt;
use std::fs;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};

use super::registry::{WorkspaceId, WorkspaceKind};

pub const MANIFEST_FILE_NAME: &str = "brain.workspace.yaml";
pub const MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct WorkspaceManifest {
    pub schema_version: u32,
    pub id: Option<WorkspaceId>,
    pub name: Option<String>,
    pub kind: WorkspaceKind,
    pub project_id: Option<String>,
    pub default_view: Option<String>,
    #[serde(default)]
    pub index: IndexSettings,
    #[serde(default)]
    pub agent: AgentSettings,
    #[serde(default)]
    pub terminal: TerminalSettings,
    #[serde(default)]
    pub security: SecurityPolicy,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IndexSettings {
    #[serde(default = "default_index_enabled")]
    pub enabled: bool,
    #[serde(default = "default_respect_gitignore")]
    pub respect_gitignore: bool,
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
}

impl Default for IndexSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            respect_gitignore: true,
            include: Vec::new(),
            exclude: Vec::new(),
        }
    }
}

fn default_index_enabled() -> bool {
    true
}

fn default_respect_gitignore() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AgentSettings {
    #[serde(default)]
    pub default_profile: Option<String>,
    #[serde(default)]
    pub auto_include_project_card: bool,
    #[serde(default)]
    pub default_context_budget: Option<u32>,
    #[serde(default = "default_workspace_root")]
    pub readable_roots: Vec<String>,
    #[serde(default)]
    pub writable_roots: Vec<String>,
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            default_profile: None,
            auto_include_project_card: false,
            default_context_budget: None,
            readable_roots: default_workspace_root(),
            writable_roots: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TerminalSettings {
    #[serde(default)]
    pub default_shell: Option<String>,
    #[serde(default = "default_max_tabs")]
    pub max_tabs: u8,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            default_shell: None,
            max_tabs: 6,
        }
    }
}

fn default_max_tabs() -> u8 {
    6
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SecurityPolicy {
    #[serde(default = "default_workspace_root")]
    pub readable: Vec<String>,
    #[serde(default)]
    pub deny_read: Vec<String>,
    #[serde(default)]
    pub writable: Vec<String>,
    #[serde(default)]
    pub deny_write: Vec<String>,
}

impl Default for SecurityPolicy {
    fn default() -> Self {
        Self {
            readable: default_workspace_root(),
            deny_read: Vec::new(),
            writable: Vec::new(),
            deny_write: Vec::new(),
        }
    }
}

fn default_workspace_root() -> Vec<String> {
    vec![".".to_owned()]
}

#[derive(Debug)]
pub enum ManifestError {
    Io(std::io::Error),
    Parse(String),
    UnsupportedVersion(u32),
    InvalidField(&'static str),
    InvalidPathPattern(String),
    KindMismatch {
        expected: WorkspaceKind,
        actual: WorkspaceKind,
    },
    IdMismatch {
        expected: WorkspaceId,
        actual: WorkspaceId,
    },
}

impl fmt::Display for ManifestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "cannot read workspace manifest: {error}"),
            Self::Parse(error) => write!(formatter, "invalid workspace manifest: {error}"),
            Self::UnsupportedVersion(version) => {
                write!(
                    formatter,
                    "unsupported workspace manifest schema version {version}"
                )
            }
            Self::InvalidField(field) => {
                write!(formatter, "invalid workspace manifest field: {field}")
            }
            Self::InvalidPathPattern(pattern) => {
                write!(
                    formatter,
                    "invalid workspace-relative policy pattern: {pattern}"
                )
            }
            Self::KindMismatch { expected, actual } => {
                write!(
                    formatter,
                    "manifest kind {actual:?} does not match workspace kind {expected:?}"
                )
            }
            Self::IdMismatch { expected, actual } => {
                write!(
                    formatter,
                    "manifest id {actual} does not match workspace id {expected}"
                )
            }
        }
    }
}

impl std::error::Error for ManifestError {}

impl From<std::io::Error> for ManifestError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub fn parse_manifest(source: &str) -> Result<WorkspaceManifest, ManifestError> {
    let manifest: WorkspaceManifest =
        serde_yaml::from_str(source).map_err(|error| ManifestError::Parse(error.to_string()))?;
    validate_manifest(manifest)
}

pub fn load_manifest(root: &Path) -> Result<WorkspaceManifest, ManifestError> {
    let path = root.join(MANIFEST_FILE_NAME);
    parse_manifest(&fs::read_to_string(path)?)
}

fn validate_manifest(mut manifest: WorkspaceManifest) -> Result<WorkspaceManifest, ManifestError> {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(ManifestError::UnsupportedVersion(manifest.schema_version));
    }
    if let Some(name) = &manifest.name {
        if name.trim().is_empty() || name.chars().count() > 200 {
            return Err(ManifestError::InvalidField("name"));
        }
    }
    if manifest.terminal.max_tabs == 0 || manifest.terminal.max_tabs > 64 {
        return Err(ManifestError::InvalidField("terminal.max_tabs"));
    }
    if manifest
        .agent
        .default_context_budget
        .is_some_and(|budget| budget == 0)
    {
        return Err(ManifestError::InvalidField("agent.default_context_budget"));
    }
    for pattern in manifest
        .index
        .include
        .iter()
        .chain(manifest.index.exclude.iter())
        .chain(manifest.security.readable.iter())
        .chain(manifest.security.deny_read.iter())
        .chain(manifest.security.writable.iter())
        .chain(manifest.security.deny_write.iter())
        .chain(manifest.agent.readable_roots.iter())
        .chain(manifest.agent.writable_roots.iter())
    {
        validate_pattern(pattern)?;
    }
    if manifest.agent.readable_roots.is_empty() {
        manifest.agent.readable_roots = default_workspace_root();
    }
    if manifest.security.readable.is_empty() {
        manifest.security.readable = default_workspace_root();
    }
    Ok(manifest)
}

/// Verify that a manifest loaded from a workspace cannot silently identify a
/// different workspace.  The manifest may tighten policy, never broaden it.
pub fn validate_for_workspace(
    manifest: &WorkspaceManifest,
    id: &WorkspaceId,
    kind: WorkspaceKind,
) -> Result<(), ManifestError> {
    if let Some(manifest_id) = &manifest.id {
        if manifest_id != id {
            return Err(ManifestError::IdMismatch {
                expected: id.clone(),
                actual: manifest_id.clone(),
            });
        }
    }
    if manifest.kind != kind {
        return Err(ManifestError::KindMismatch {
            expected: kind,
            actual: manifest.kind,
        });
    }
    Ok(())
}

fn validate_pattern(pattern: &str) -> Result<(), ManifestError> {
    if pattern.is_empty() || pattern.as_bytes().contains(&0) || pattern.contains('\\') {
        return Err(ManifestError::InvalidPathPattern(pattern.to_owned()));
    }
    let candidate = Path::new(pattern);
    if candidate.is_absolute()
        || pattern.starts_with('/')
        || pattern.starts_with("//")
        || pattern.as_bytes().get(1).is_some_and(|byte| *byte == b':')
    {
        return Err(ManifestError::InvalidPathPattern(pattern.to_owned()));
    }
    for component in candidate.components() {
        if matches!(component, Component::ParentDir) {
            return Err(ManifestError::InvalidPathPattern(pattern.to_owned()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_manifest_v1_and_defaults_policy_roots() {
        let manifest = parse_manifest(
            "schema_version: 1\nkind: project\nname: Demo\nterminal:\n  max_tabs: 2\n",
        )
        .expect("manifest");
        assert_eq!(manifest.kind, WorkspaceKind::Project);
        assert_eq!(manifest.agent.readable_roots, vec!["."]);
        assert_eq!(manifest.terminal.max_tabs, 2);
    }

    #[test]
    fn rejects_unsupported_schema_and_parent_policy() {
        assert!(matches!(
            parse_manifest("schema_version: 2\nkind: project\n"),
            Err(ManifestError::UnsupportedVersion(2))
        ));
        assert!(matches!(
            parse_manifest(
                "schema_version: 1\nkind: project\nsecurity:\n  deny_read: ['../outside']\n"
            ),
            Err(ManifestError::InvalidPathPattern(_))
        ));
    }
}
