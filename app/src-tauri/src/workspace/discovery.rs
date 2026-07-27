use std::fmt;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use super::ignore_policy::{AccessLayer, IgnorePolicy};
use super::path_policy::{PathPolicyError, ValidatedWorkspacePath};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DirectoryEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: FileKind,
    pub size_bytes: u64,
    pub modified_unix_seconds: Option<u64>,
    pub ignored: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DirectoryPage {
    pub entries: Vec<DirectoryEntry>,
    pub next_cursor: Option<usize>,
}

#[derive(Debug)]
pub enum DiscoveryError {
    NotDirectory,
    PermissionDenied,
    Io(String),
    Path(PathPolicyError),
}

impl fmt::Display for DiscoveryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotDirectory => formatter.write_str("path is not a directory"),
            Self::PermissionDenied => formatter.write_str("permission denied"),
            Self::Io(message) => write!(formatter, "directory enumeration failed: {message}"),
            Self::Path(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for DiscoveryError {}

impl From<PathPolicyError> for DiscoveryError {
    fn from(error: PathPolicyError) -> Self {
        Self::Path(error)
    }
}

/// Enumerates one directory at a time.  `cursor` is an offset, and no child
/// directories are traversed here; callers can request pages on demand.
pub fn list_directory(
    directory: &ValidatedWorkspacePath,
    cursor: usize,
    limit: usize,
    ignore: Option<(&IgnorePolicy, AccessLayer)>,
) -> Result<DirectoryPage, DiscoveryError> {
    if !directory.absolute_path.is_dir() {
        return Err(DiscoveryError::NotDirectory);
    }
    let limit = limit.clamp(1, 500);
    let mut entries = Vec::with_capacity(limit);
    let mut seen = 0_usize;
    let mut has_more = false;
    for item in fs::read_dir(&directory.absolute_path).map_err(map_io_error)? {
        let item = item.map_err(map_io_error)?;
        if seen < cursor {
            seen += 1;
            continue;
        }
        if entries.len() >= limit {
            has_more = true;
            break;
        }
        let path = item.path();
        let metadata = fs::symlink_metadata(&path).map_err(map_io_error)?;
        let kind = file_kind(&metadata);
        let name = item.file_name().to_string_lossy().into_owned();
        let relative_path = join_relative(&directory.relative_path, &name);
        let ignored = ignore.is_some_and(|(policy, layer)| {
            !policy.allowed(
                Path::new(&relative_path),
                layer,
                kind == FileKind::Directory,
            )
        });
        entries.push(DirectoryEntry {
            name,
            relative_path,
            kind,
            size_bytes: metadata.len(),
            modified_unix_seconds: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs()),
            ignored,
        });
        seen += 1;
    }
    Ok(DirectoryPage {
        entries,
        next_cursor: has_more.then_some(cursor + limit),
    })
}

fn file_kind(metadata: &fs::Metadata) -> FileKind {
    let file_type = metadata.file_type();
    if file_type.is_dir() {
        FileKind::Directory
    } else if file_type.is_file() {
        FileKind::File
    } else if file_type.is_symlink() {
        FileKind::Symlink
    } else {
        FileKind::Other
    }
}

fn join_relative(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}/{name}")
    }
}

fn map_io_error(error: std::io::Error) -> DiscoveryError {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => DiscoveryError::PermissionDenied,
        _ => DiscoveryError::Io(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{
        PathPolicy, RegisterWorkspace, WorkspaceId, WorkspaceKind, WorkspacePath, WorkspaceRegistry,
    };

    #[test]
    fn lists_one_directory_in_bounded_pages_without_recursion() {
        let root = tempfile::tempdir().expect("tempdir");
        std::fs::write(root.path().join("a.txt"), "a").expect("a");
        std::fs::create_dir(root.path().join("nested")).expect("nested");
        std::fs::write(root.path().join("nested/secret.txt"), "secret").expect("nested file");
        let mut registry = WorkspaceRegistry::new();
        let workspace = registry
            .register(RegisterWorkspace {
                id: Some(WorkspaceId::from("ws_discovery")),
                name: "Discovery".into(),
                kind: WorkspaceKind::Project,
                display_root: Some(root.path().to_owned()),
                trust_level: None,
            })
            .expect("workspace");
        let path = WorkspacePath::root(workspace.id.clone());
        let validated = PathPolicy::default()
            .validate(&workspace, &path)
            .expect("root");
        let first = list_directory(&validated, 0, 1, None).expect("page");
        assert_eq!(first.entries.len(), 1);
        assert_eq!(first.next_cursor, Some(1));
        assert!(!first.entries[0].relative_path.contains("secret.txt"));
    }
}
