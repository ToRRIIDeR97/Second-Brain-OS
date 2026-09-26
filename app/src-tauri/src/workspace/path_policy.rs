use std::fmt;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::registry::{WorkspaceId, WorkspaceRecord};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct WorkspacePath {
    pub workspace_id: WorkspaceId,
    pub relative_path: String,
}

impl WorkspacePath {
    pub fn new(
        workspace_id: WorkspaceId,
        relative_path: impl Into<String>,
    ) -> Result<Self, PathPolicyError> {
        let relative_path = relative_path.into();
        validate_relative_path(&relative_path)?;
        Ok(Self {
            workspace_id,
            relative_path,
        })
    }

    #[must_use]
    pub fn root(workspace_id: WorkspaceId) -> Self {
        Self {
            workspace_id,
            relative_path: String::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SymlinkPolicy {
    #[default]
    FollowInsideWorkspace,
    Deny,
}

#[derive(Clone, Debug)]
pub struct PathPolicy {
    pub symlink_policy: SymlinkPolicy,
}

impl Default for PathPolicy {
    fn default() -> Self {
        Self {
            symlink_policy: SymlinkPolicy::FollowInsideWorkspace,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ValidatedWorkspacePath {
    pub workspace_id: WorkspaceId,
    pub relative_path: String,
    /// Backend-only path.  Do not serialize this into renderer responses.
    pub absolute_path: PathBuf,
    pub canonical_path: PathBuf,
    pub canonical_parent: PathBuf,
    pub exists: bool,
    pub is_symlink: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PathPolicyError {
    WorkspaceMismatch,
    VirtualWorkspace,
    InvalidPath(String),
    MissingWorkspaceRoot,
    PermissionDenied,
    NotFound,
    BrokenSymlink,
    SymlinkDenied,
    SymlinkEscape,
    OutsideWorkspace,
    Io(String),
}

impl fmt::Display for PathPolicyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WorkspaceMismatch => {
                formatter.write_str("workspace path does not match the selected workspace")
            }
            Self::VirtualWorkspace => {
                formatter.write_str("virtual collection workspaces have no files")
            }
            Self::InvalidPath(path) => write!(formatter, "invalid workspace-relative path: {path}"),
            Self::MissingWorkspaceRoot => formatter.write_str("workspace has no filesystem root"),
            Self::PermissionDenied => formatter.write_str("permission denied"),
            Self::NotFound => formatter.write_str("path does not exist"),
            Self::BrokenSymlink => formatter.write_str("path contains a broken symlink"),
            Self::SymlinkDenied => {
                formatter.write_str("symlink access is denied by workspace policy")
            }
            Self::SymlinkEscape => formatter.write_str("symlink resolves outside the workspace"),
            Self::OutsideWorkspace => formatter.write_str("path resolves outside the workspace"),
            Self::Io(message) => write!(formatter, "filesystem policy check failed: {message}"),
        }
    }
}

impl std::error::Error for PathPolicyError {}

impl PathPolicy {
    pub fn validate(
        &self,
        workspace: &WorkspaceRecord,
        path: &WorkspacePath,
    ) -> Result<ValidatedWorkspacePath, PathPolicyError> {
        if workspace.id != path.workspace_id {
            return Err(PathPolicyError::WorkspaceMismatch);
        }
        let root = workspace.root_path().ok_or_else(|| {
            if workspace.canonical_root.is_none() {
                PathPolicyError::VirtualWorkspace
            } else {
                PathPolicyError::MissingWorkspaceRoot
            }
        })?;
        validate_relative_path(&path.relative_path)?;
        let absolute_path = root.join(
            path.relative_path
                .replace('/', std::path::MAIN_SEPARATOR_STR),
        );
        let metadata = fs::symlink_metadata(&absolute_path).map_err(map_io_error)?;
        let contains_symlink = path_contains_symlink(root, &absolute_path)?;
        if contains_symlink && self.symlink_policy == SymlinkPolicy::Deny {
            return Err(PathPolicyError::SymlinkDenied);
        }
        let canonical_path = fs::canonicalize(&absolute_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                PathPolicyError::BrokenSymlink
            } else {
                map_io_error(error)
            }
        })?;
        let canonical_root = fs::canonicalize(root).map_err(map_io_error)?;
        if !is_within(&canonical_root, &canonical_path) {
            return if contains_symlink {
                Err(PathPolicyError::SymlinkEscape)
            } else {
                Err(PathPolicyError::OutsideWorkspace)
            };
        }
        let canonical_parent = canonical_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| canonical_root.clone());
        Ok(ValidatedWorkspacePath {
            workspace_id: path.workspace_id.clone(),
            relative_path: path.relative_path.clone(),
            absolute_path,
            canonical_path,
            canonical_parent,
            exists: true,
            is_symlink: contains_symlink || metadata.file_type().is_symlink(),
        })
    }

    /// Validate a path that may not exist yet.  This is useful to read a
    /// directory while it is being replaced; write operations remain owned by
    /// checkpoint 07 and must perform their own stronger parent checks.
    pub fn validate_nearest_existing_parent(
        &self,
        workspace: &WorkspaceRecord,
        path: &WorkspacePath,
    ) -> Result<ValidatedWorkspacePath, PathPolicyError> {
        if workspace.id != path.workspace_id {
            return Err(PathPolicyError::WorkspaceMismatch);
        }
        let root = workspace
            .root_path()
            .ok_or(PathPolicyError::VirtualWorkspace)?;
        validate_relative_path(&path.relative_path)?;
        let absolute_path = root.join(
            path.relative_path
                .replace('/', std::path::MAIN_SEPARATOR_STR),
        );
        let canonical_root = fs::canonicalize(root).map_err(map_io_error)?;
        let (nearest, exists) = nearest_existing(&absolute_path)?;
        let nearest_is_symlink = fs::symlink_metadata(&nearest)
            .map_err(map_io_error)?
            .file_type()
            .is_symlink();
        let canonical_parent = fs::canonicalize(&nearest).map_err(|error| {
            if nearest_is_symlink && error.kind() == std::io::ErrorKind::NotFound {
                PathPolicyError::BrokenSymlink
            } else {
                map_io_error(error)
            }
        })?;
        if !is_within(&canonical_root, &canonical_parent) {
            return Err(PathPolicyError::SymlinkEscape);
        }
        if exists {
            return self.validate(workspace, path);
        }
        Ok(ValidatedWorkspacePath {
            workspace_id: path.workspace_id.clone(),
            relative_path: path.relative_path.clone(),
            absolute_path,
            canonical_path: canonical_parent.clone(),
            canonical_parent,
            exists: false,
            is_symlink: false,
        })
    }
}

fn nearest_existing(path: &Path) -> Result<(PathBuf, bool), PathPolicyError> {
    let mut candidate = path.to_path_buf();
    loop {
        match fs::symlink_metadata(&candidate) {
            Ok(_) => return Ok((candidate.clone(), candidate == path)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                candidate = candidate
                    .parent()
                    .ok_or(PathPolicyError::NotFound)?
                    .to_path_buf();
            }
            Err(error) => return Err(map_io_error(error)),
        }
    }
}

fn map_io_error(error: std::io::Error) -> PathPolicyError {
    match error.kind() {
        std::io::ErrorKind::NotFound => PathPolicyError::NotFound,
        std::io::ErrorKind::PermissionDenied => PathPolicyError::PermissionDenied,
        _ => PathPolicyError::Io(error.to_string()),
    }
}

fn is_within(root: &Path, path: &Path) -> bool {
    path == root || path.strip_prefix(root).is_ok()
}

fn path_contains_symlink(root: &Path, path: &Path) -> Result<bool, PathPolicyError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| PathPolicyError::OutsideWorkspace)?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            continue;
        };
        current.push(name);
        if fs::symlink_metadata(&current)
            .map_err(map_io_error)?
            .file_type()
            .is_symlink()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(crate) fn validate_relative_path(path: &str) -> Result<(), PathPolicyError> {
    if path.as_bytes().contains(&0) || path.contains('\\') || has_encoded_escape(path) {
        return Err(PathPolicyError::InvalidPath(path.to_owned()));
    }
    let candidate = Path::new(path);
    if candidate.is_absolute()
        || path.starts_with('/')
        || path.starts_with("//")
        || path.as_bytes().get(1).is_some_and(|byte| *byte == b':')
    {
        return Err(PathPolicyError::InvalidPath(path.to_owned()));
    }
    for component in candidate.components() {
        if matches!(component, Component::ParentDir) {
            return Err(PathPolicyError::InvalidPath(path.to_owned()));
        }
    }
    Ok(())
}

fn has_encoded_escape(path: &str) -> bool {
    let mut current = path.as_bytes().to_vec();
    for _ in 0..4 {
        let mut decoded = Vec::with_capacity(current.len());
        let mut changed = false;
        let mut index = 0;
        while index < current.len() {
            if index + 2 < current.len() && current[index] == b'%' {
                let Some(high) = hex_value(current[index + 1]) else {
                    decoded.push(current[index]);
                    index += 1;
                    continue;
                };
                let Some(low) = hex_value(current[index + 2]) else {
                    decoded.push(current[index]);
                    index += 1;
                    continue;
                };
                let value = (high << 4) | low;
                if matches!(value, b'.' | b'/' | b'\\' | 0) {
                    return true;
                }
                decoded.push(value);
                index += 3;
                changed = true;
            } else {
                decoded.push(current[index]);
                index += 1;
            }
        }
        if !changed {
            return false;
        }
        current = decoded;
    }
    false
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{RegisterWorkspace, WorkspaceKind, WorkspaceRegistry};

    fn workspace(root: &Path) -> WorkspaceRecord {
        let mut registry = WorkspaceRegistry::new();
        registry
            .register(RegisterWorkspace {
                id: Some(WorkspaceId::from("ws_path")),
                name: "Paths".into(),
                kind: WorkspaceKind::Project,
                display_root: Some(root.to_owned()),
                trust_level: None,
            })
            .expect("workspace")
    }

    #[test]
    fn rejects_host_paths_traversal_and_encoded_escapes() {
        let id = WorkspaceId::from("ws_path");
        for path in [
            "/tmp/outside",
            "C:/outside",
            "\\\\server\\share",
            "../outside",
            "a\\b",
            "%2e%2e/out",
            "%252e%252e/out",
        ] {
            assert!(matches!(
                WorkspacePath::new(id.clone(), path),
                Err(PathPolicyError::InvalidPath(_))
            ));
        }
    }

    #[test]
    fn symlink_escape_is_rejected() {
        let temp = tempfile::tempdir().expect("tempdir");
        let outside = tempfile::tempdir().expect("outside");
        std::fs::write(outside.path().join("secret.txt"), "secret").expect("secret");
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), temp.path().join("escape")).expect("symlink");
        #[cfg(windows)]
        if let Err(error) =
            std::os::windows::fs::symlink_dir(outside.path(), temp.path().join("escape"))
        {
            if error.raw_os_error() == Some(1314) {
                return;
            }
            panic!("symlink: {error}");
        }
        let workspace = workspace(temp.path());
        let path =
            WorkspacePath::new(WorkspaceId::from("ws_path"), "escape/secret.txt").expect("path");
        let result = PathPolicy::default().validate(&workspace, &path);
        assert!(
            matches!(result, Err(PathPolicyError::SymlinkEscape)),
            "result: {result:?}"
        );
    }

    #[test]
    fn missing_target_uses_nearest_existing_parent() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = workspace(temp.path());
        let path = WorkspacePath::new(WorkspaceId::from("ws_path"), "new/file.txt").expect("path");
        let result = PathPolicy::default()
            .validate_nearest_existing_parent(&workspace, &path)
            .expect("parent");
        assert!(!result.exists);
        assert_eq!(
            result.canonical_parent,
            std::fs::canonicalize(temp.path()).expect("canonical")
        );
    }
}
