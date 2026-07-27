use std::fmt;
use std::path::{Path, PathBuf};

use ignore::gitignore::{Gitignore, GitignoreBuilder};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccessLayer {
    /// User-visible tree; Git metadata is not a security boundary and is not
    /// applied unless the caller explicitly requests `GitTracking`.
    Visibility,
    GitTracking,
    Index,
    Agent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IgnoreDecision {
    Allow,
    Ignore,
    Negated,
}

#[derive(Debug)]
pub enum IgnoreError {
    InvalidPattern { file: PathBuf, message: String },
    Io { file: PathBuf, message: String },
}

impl fmt::Display for IgnoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPattern { file, message } => {
                write!(
                    formatter,
                    "invalid ignore pattern in {}: {message}",
                    file.display()
                )
            }
            Self::Io { file, message } => write!(
                formatter,
                "cannot read ignore file {}: {message}",
                file.display()
            ),
        }
    }
}

impl std::error::Error for IgnoreError {}

/// Separate matchers preserve the distinction between visibility, indexing,
/// and agent-context policy.  `.gitignore` is never treated as a security
/// boundary.
pub struct IgnorePolicy {
    root: PathBuf,
    git: Gitignore,
    brain: Gitignore,
    agent: Gitignore,
}

impl IgnorePolicy {
    pub fn from_root(root: impl Into<PathBuf>) -> Result<Self, IgnoreError> {
        let root = root.into();
        Ok(Self {
            git: load_matcher(&root, ".gitignore")?,
            brain: load_matcher(&root, ".brainignore")?,
            agent: load_matcher(&root, ".agentignore")?,
            root,
        })
    }

    pub fn from_patterns(
        root: impl Into<PathBuf>,
        git: &[&str],
        brain: &[&str],
        agent: &[&str],
    ) -> Result<Self, IgnoreError> {
        let root = root.into();
        Ok(Self {
            git: matcher_from_patterns(&root, ".gitignore", git)?,
            brain: matcher_from_patterns(&root, ".brainignore", brain)?,
            agent: matcher_from_patterns(&root, ".agentignore", agent)?,
            root,
        })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn decision(
        &self,
        relative_path: &Path,
        layer: AccessLayer,
        is_dir: bool,
    ) -> IgnoreDecision {
        let matcher = match layer {
            AccessLayer::Visibility => return IgnoreDecision::Allow,
            AccessLayer::GitTracking => &self.git,
            AccessLayer::Index => &self.brain,
            AccessLayer::Agent => &self.agent,
        };
        let matched = matcher.matched_path_or_any_parents(relative_path, is_dir);
        if matched.is_ignore() {
            IgnoreDecision::Ignore
        } else if matched.is_whitelist() {
            IgnoreDecision::Negated
        } else {
            IgnoreDecision::Allow
        }
    }

    #[must_use]
    pub fn allowed(&self, relative_path: &Path, layer: AccessLayer, is_dir: bool) -> bool {
        self.decision(relative_path, layer, is_dir) != IgnoreDecision::Ignore
    }
}

fn load_matcher(root: &Path, name: &str) -> Result<Gitignore, IgnoreError> {
    let path = root.join(name);
    if !path.exists() {
        return matcher_from_patterns(root, name, &[]);
    }
    let mut builder = GitignoreBuilder::new(root);
    if let Some(error) = builder.add(&path) {
        return Err(IgnoreError::InvalidPattern {
            file: path,
            message: error.to_string(),
        });
    }
    builder
        .build()
        .map_err(|error| IgnoreError::InvalidPattern {
            file: root.join(name),
            message: error.to_string(),
        })
}

fn matcher_from_patterns(
    root: &Path,
    name: &str,
    patterns: &[&str],
) -> Result<Gitignore, IgnoreError> {
    let mut builder = GitignoreBuilder::new(root);
    for pattern in patterns {
        builder
            .add_line(Some(name.into()), pattern)
            .map_err(|error| IgnoreError::InvalidPattern {
                file: root.join(name),
                message: error.to_string(),
            })?;
    }
    builder
        .build()
        .map_err(|error| IgnoreError::InvalidPattern {
            file: root.join(name),
            message: error.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layers_remain_distinct_and_support_negation() {
        let root = tempfile::tempdir().expect("tempdir");
        let policy = IgnorePolicy::from_patterns(
            root.path(),
            &["*.log"],
            &["generated/", "!generated/keep.md"],
            &[".env", ".env.*"],
        )
        .expect("ignore policy");
        assert!(policy.allowed(Path::new("debug.log"), AccessLayer::Visibility, false));
        assert_eq!(
            policy.decision(Path::new("debug.log"), AccessLayer::GitTracking, false),
            IgnoreDecision::Ignore
        );
        assert_eq!(
            policy.decision(Path::new("generated/x.md"), AccessLayer::Index, false),
            IgnoreDecision::Ignore
        );
        assert_eq!(
            policy.decision(Path::new("generated/keep.md"), AccessLayer::Index, false),
            IgnoreDecision::Negated
        );
        assert!(policy.allowed(Path::new("generated/x.md"), AccessLayer::Agent, false));
        assert_eq!(
            policy.decision(Path::new(".env"), AccessLayer::Agent, false),
            IgnoreDecision::Ignore
        );
    }
}
