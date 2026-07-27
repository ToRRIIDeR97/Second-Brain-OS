use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom};

use serde::{Deserialize, Serialize};

use super::path_policy::{PathPolicy, PathPolicyError, ValidatedWorkspacePath, WorkspacePath};
use super::registry::WorkspaceRecord;

pub const DEFAULT_TEXT_LIMIT: u64 = 1_048_576;
pub const DEFAULT_CHUNK_LIMIT: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TextRead {
    pub content: String,
    pub size_bytes: u64,
    pub truncated: bool,
}

#[derive(Debug)]
pub enum ReadError {
    Path(PathPolicyError),
    PermissionDenied,
    NotFile,
    TooLarge { size_bytes: u64, limit_bytes: u64 },
    InvalidUtf8,
    Io(String),
}

impl fmt::Display for ReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Path(error) => error.fmt(formatter),
            Self::PermissionDenied => formatter.write_str("permission denied"),
            Self::NotFile => formatter.write_str("path is not a regular file"),
            Self::TooLarge {
                size_bytes,
                limit_bytes,
            } => {
                write!(
                    formatter,
                    "file is {size_bytes} bytes, above the {limit_bytes}-byte text limit"
                )
            }
            Self::InvalidUtf8 => formatter.write_str("file is not valid UTF-8 text"),
            Self::Io(message) => write!(formatter, "file read failed: {message}"),
        }
    }
}

impl std::error::Error for ReadError {}

impl From<PathPolicyError> for ReadError {
    fn from(error: PathPolicyError) -> Self {
        Self::Path(error)
    }
}

/// An open, bounded reader.  It never exposes an arbitrary path to the
/// renderer and can be used for chunked large-file streaming by a later IPC
/// adapter.
pub struct FileDescriptor {
    file: File,
    pub size_bytes: u64,
    pub validated: ValidatedWorkspacePath,
}

impl fmt::Debug for FileDescriptor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FileDescriptor")
            .field("size_bytes", &self.size_bytes)
            .field("relative_path", &self.validated.relative_path)
            .finish_non_exhaustive()
    }
}

impl FileDescriptor {
    pub fn read_chunk(&mut self, offset: u64, limit: usize) -> Result<Vec<u8>, ReadError> {
        let limit = limit.clamp(1, DEFAULT_CHUNK_LIMIT);
        self.file
            .seek(SeekFrom::Start(offset))
            .map_err(map_io_error)?;
        let mut bytes = vec![0_u8; limit];
        let read = self.file.read(&mut bytes).map_err(map_io_error)?;
        bytes.truncate(read);
        Ok(bytes)
    }

    pub fn read_utf8(&mut self, limit_bytes: u64) -> Result<TextRead, ReadError> {
        if self.size_bytes > limit_bytes {
            return Err(ReadError::TooLarge {
                size_bytes: self.size_bytes,
                limit_bytes,
            });
        }
        let capacity = usize::try_from(self.size_bytes).map_err(|_| ReadError::TooLarge {
            size_bytes: self.size_bytes,
            limit_bytes,
        })?;
        let read_limit = usize::try_from(limit_bytes.saturating_add(1)).unwrap_or(usize::MAX);
        let mut bytes = Vec::with_capacity(capacity.min(read_limit));
        self.file.seek(SeekFrom::Start(0)).map_err(map_io_error)?;
        self.file
            .by_ref()
            .take(read_limit as u64)
            .read_to_end(&mut bytes)
            .map_err(map_io_error)?;
        if bytes.len() as u64 > limit_bytes {
            return Err(ReadError::TooLarge {
                size_bytes: bytes.len() as u64,
                limit_bytes,
            });
        }
        let size_bytes = bytes.len() as u64;
        let content = String::from_utf8(bytes).map_err(|_| ReadError::InvalidUtf8)?;
        Ok(TextRead {
            content,
            size_bytes,
            truncated: false,
        })
    }
}

pub fn open_file(
    policy: &PathPolicy,
    workspace: &WorkspaceRecord,
    path: &WorkspacePath,
) -> Result<FileDescriptor, ReadError> {
    let validated = policy.validate(workspace, path)?;
    open_validated(validated)
}

pub fn open_validated(validated: ValidatedWorkspacePath) -> Result<FileDescriptor, ReadError> {
    let metadata = std::fs::metadata(&validated.absolute_path).map_err(map_io_error)?;
    if !metadata.is_file() {
        return Err(ReadError::NotFile);
    }
    let file = OpenOptions::new()
        .read(true)
        .open(&validated.absolute_path)
        .map_err(map_io_error)?;
    // Re-check the path after opening.  This narrows (but cannot fully close)
    // the validation/open race until the platform adapter can use descriptor-
    // relative no-follow opens.
    let opened_canonical = std::fs::canonicalize(&validated.absolute_path).map_err(map_io_error)?;
    if opened_canonical != validated.canonical_path {
        return Err(ReadError::Path(PathPolicyError::SymlinkEscape));
    }
    Ok(FileDescriptor {
        file,
        size_bytes: metadata.len(),
        validated,
    })
}

pub fn read_text(
    policy: &PathPolicy,
    workspace: &WorkspaceRecord,
    path: &WorkspacePath,
    limit_bytes: Option<u64>,
) -> Result<TextRead, ReadError> {
    let mut descriptor = open_file(policy, workspace, path)?;
    descriptor.read_utf8(limit_bytes.unwrap_or(DEFAULT_TEXT_LIMIT))
}

fn map_io_error(error: io::Error) -> ReadError {
    match error.kind() {
        io::ErrorKind::PermissionDenied => ReadError::PermissionDenied,
        _ => ReadError::Io(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{RegisterWorkspace, WorkspaceId, WorkspaceKind, WorkspaceRegistry};

    fn workspace(root: &std::path::Path) -> WorkspaceRecord {
        let mut registry = WorkspaceRegistry::new();
        registry
            .register(RegisterWorkspace {
                id: Some(WorkspaceId::from("ws_reader")),
                name: "Reader".into(),
                kind: WorkspaceKind::Project,
                display_root: Some(root.to_owned()),
                trust_level: None,
            })
            .expect("workspace")
    }

    #[test]
    fn reads_utf8_and_rejects_oversized_text() {
        let root = tempfile::tempdir().expect("tempdir");
        std::fs::write(root.path().join("note.md"), "hello π").expect("note");
        let workspace = workspace(root.path());
        let path = WorkspacePath::new(WorkspaceId::from("ws_reader"), "note.md").expect("path");
        let read = read_text(&PathPolicy::default(), &workspace, &path, Some(100)).expect("read");
        assert_eq!(read.content, "hello π");
        assert!(matches!(
            read_text(&PathPolicy::default(), &workspace, &path, Some(2)),
            Err(ReadError::TooLarge { .. })
        ));
    }

    #[test]
    fn file_descriptor_chunks_are_bounded() {
        let root = tempfile::tempdir().expect("tempdir");
        std::fs::write(root.path().join("data.bin"), b"0123456789").expect("data");
        let workspace = workspace(root.path());
        let path = WorkspacePath::new(WorkspaceId::from("ws_reader"), "data.bin").expect("path");
        let mut descriptor = open_file(&PathPolicy::default(), &workspace, &path).expect("open");
        assert_eq!(descriptor.read_chunk(3, 4).expect("chunk"), b"3456");
    }
}
