//! Safe, hash-aware workspace file mutations.
//!
//! This module intentionally does not own Tauri commands, database writes, or
//! indexing.  Callers validate workspace policy before constructing a service;
//! the service still performs a second, cheap root-boundary check at every
//! operation because file paths can disappear or be replaced between calls.

use std::fs::{self, OpenOptions, Permissions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ulid::Ulid;

use super::trash::{FailClosedTrash, TrashAdapter};

/// A renderer-safe file reference.  Absolute paths never cross this boundary.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePath {
    pub workspace_id: String,
    pub relative_path: String,
}

impl WorkspacePath {
    #[must_use]
    pub fn new(workspace_id: impl Into<String>, relative_path: impl Into<String>) -> Self {
        Self {
            workspace_id: workspace_id.into(),
            relative_path: relative_path.into(),
        }
    }
}

/// Audit identity supplied by the command/session layer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationActor {
    pub actor_type: String,
    pub actor_id: String,
}

impl MutationActor {
    #[must_use]
    pub fn user(actor_id: impl Into<String>) -> Self {
        Self {
            actor_type: "user".into(),
            actor_id: actor_id.into(),
        }
    }
}

/// Inputs for an optimistic text save.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextRequest {
    pub content: String,
    /// Required when the destination exists.  `None` means create-only.
    pub base_hash: Option<String>,
    /// Retained by the editor so a disk change can be merged without a
    /// revision-content table in this checkpoint.
    pub base_content: Option<String>,
    pub actor: MutationActor,
    pub correlation_id: String,
    pub operation_id: Option<String>,
}

impl WriteTextRequest {
    #[must_use]
    pub fn new(content: impl Into<String>, base_hash: Option<String>) -> Self {
        Self {
            content: content.into(),
            base_hash,
            base_content: None,
            actor: MutationActor::user("unknown"),
            correlation_id: Ulid::new().to_string(),
            operation_id: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub operation_id: String,
    pub revision_id: String,
    pub content_hash: Option<String>,
    pub size_bytes: u64,
    pub source_path: Option<WorkspacePath>,
    pub target_path: WorkspacePath,
    pub non_atomic: bool,
    pub merge_notice: bool,
    pub correlation_id: String,
    pub actor: MutationActor,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictKind {
    ExternalText,
    DeletedOnDisk,
    CreatedOnDisk,
    BinaryOnDisk,
    ConcurrentChange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextState {
    pub exists: bool,
    pub hash: Option<String>,
    pub content: Option<String>,
    pub binary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictResult {
    pub kind: ConflictKind,
    pub base: TextState,
    pub disk: TextState,
    pub editor: TextState,
    pub clean_merge: Option<String>,
    pub operation_id: String,
    pub correlation_id: String,
    pub actor: MutationActor,
}

#[derive(Debug, Error)]
pub enum MutationError {
    #[error("workspace path belongs to another workspace")]
    WorkspaceMismatch,
    #[error("invalid workspace-relative path: {0}")]
    InvalidPath(String),
    #[error("path escapes the registered workspace")]
    PathEscape,
    #[error("file does not exist")]
    NotFound,
    #[error("destination already exists")]
    AlreadyExists,
    #[error("an existing text file requires its base hash")]
    BaseHashRequired,
    #[error("the target is not a supported text file")]
    BinaryFile,
    #[error("the file changed while it was being saved")]
    ConcurrentChange,
    #[error("cross-volume directory moves are unsupported")]
    CrossVolumeMoveUnsupported,
    #[error("operating-system trash is unavailable")]
    TrashUnavailable,
    #[error("file conflict")]
    Conflict(Box<ConflictResult>),
    #[error("filesystem operation failed: {0}")]
    Io(String),
}

impl From<io::Error> for MutationError {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self::NotFound,
            io::ErrorKind::PermissionDenied => Self::Io("permission denied".into()),
            _ => Self::Io(error.to_string()),
        }
    }
}

#[derive(Debug, Clone)]
struct FileState {
    exists: bool,
    hash: Option<String>,
    content: Option<String>,
    bytes: Vec<u8>,
    binary: bool,
    permissions: Option<Permissions>,
    is_directory: bool,
}

impl FileState {
    fn missing() -> Self {
        Self {
            exists: false,
            hash: None,
            content: None,
            bytes: Vec::new(),
            binary: false,
            permissions: None,
            is_directory: false,
        }
    }

    fn as_text_state(&self) -> TextState {
        TextState {
            exists: self.exists,
            hash: self.hash.clone(),
            content: self.content.clone(),
            binary: self.binary,
        }
    }
}

/// Workspace mutation service.  `T` is injected so native-trash failures fail
/// closed and tests never touch an operating-system trash location.
#[derive(Debug)]
pub struct MutationService<T: TrashAdapter = FailClosedTrash> {
    workspace_id: String,
    root: PathBuf,
    canonical_root: PathBuf,
    trash: T,
}

impl MutationService<FailClosedTrash> {
    pub fn new(
        workspace_id: impl Into<String>,
        root: impl Into<PathBuf>,
    ) -> Result<Self, MutationError> {
        Self::with_trash(workspace_id, root, FailClosedTrash)
    }
}

impl<T: TrashAdapter> MutationService<T> {
    pub fn with_trash(
        workspace_id: impl Into<String>,
        root: impl Into<PathBuf>,
        trash: T,
    ) -> Result<Self, MutationError> {
        let workspace_id = workspace_id.into();
        if workspace_id.trim().is_empty() {
            return Err(MutationError::InvalidPath("empty workspace id".into()));
        }
        let root = root.into();
        let canonical_root = fs::canonicalize(&root)?;
        if !canonical_root.is_dir() {
            return Err(MutationError::InvalidPath(
                "workspace root is not a directory".into(),
            ));
        }
        Ok(Self {
            workspace_id,
            root,
            canonical_root,
            trash,
        })
    }

    /// Atomically creates or replaces a UTF-8 text file with optimistic hash
    /// checking.  A clean three-way merge is committed against the latest disk
    /// hash and reported through `merge_notice`; unresolved merges return all
    /// three states without writing either side.
    pub fn write_text(
        &self,
        path: &WorkspacePath,
        request: WriteTextRequest,
    ) -> Result<MutationResult, MutationError> {
        let target = self.checked_path(path)?;
        let operation_id = operation_id(request.operation_id.as_deref());
        let current = self.read_state(&target)?;

        if current.exists && current.is_directory {
            return Err(MutationError::Io("cannot write a directory as text".into()));
        }
        if current.exists {
            let Some(base_hash) = request.base_hash.as_deref() else {
                return Err(MutationError::BaseHashRequired);
            };
            if current.binary {
                if current.hash.as_deref() != Some(base_hash) {
                    return Err(MutationError::Conflict(Box::new(ConflictResult {
                        kind: ConflictKind::BinaryOnDisk,
                        base: TextState {
                            exists: true,
                            hash: request.base_hash.clone(),
                            content: request.base_content.clone(),
                            binary: false,
                        },
                        disk: current.as_text_state(),
                        editor: text_state(&request.content),
                        clean_merge: None,
                        operation_id,
                        correlation_id: request.correlation_id,
                        actor: request.actor,
                    })));
                }
                return Err(MutationError::BinaryFile);
            }
            if current.hash.as_deref() != Some(base_hash) {
                let base = TextState {
                    exists: true,
                    hash: request.base_hash.clone(),
                    content: request.base_content.clone(),
                    binary: false,
                };
                let editor = text_state(&request.content);
                let disk = current.as_text_state();
                let clean_merge = request.base_content.as_deref().and_then(|base_content| {
                    three_way_merge(base_content, current.content.as_deref()?, &request.content)
                });
                if let Some(merged) = clean_merge {
                    return self
                        .commit_text(
                            path,
                            &target,
                            &merged,
                            current.hash.as_deref(),
                            operation_id.clone(),
                            true,
                            &request,
                        )
                        .map_err(|error| match error {
                            MutationError::ConcurrentChange => {
                                self.race_conflict(&target, &request, operation_id)
                            }
                            error => error,
                        });
                }
                return Err(MutationError::Conflict(Box::new(ConflictResult {
                    kind: ConflictKind::ExternalText,
                    base,
                    disk,
                    editor,
                    clean_merge: None,
                    operation_id,
                    correlation_id: request.correlation_id,
                    actor: request.actor,
                })));
            }
        } else if request.base_hash.is_some() {
            return Err(MutationError::Conflict(Box::new(ConflictResult {
                kind: ConflictKind::DeletedOnDisk,
                base: TextState {
                    exists: true,
                    hash: request.base_hash.clone(),
                    content: request.base_content,
                    binary: false,
                },
                disk: current.as_text_state(),
                editor: text_state(&request.content),
                clean_merge: None,
                operation_id,
                correlation_id: request.correlation_id,
                actor: request.actor,
            })));
        }

        self.commit_text(
            path,
            &target,
            &request.content,
            request.base_hash.as_deref(),
            operation_id.clone(),
            false,
            &request,
        )
        .map_err(|error| match error {
            MutationError::ConcurrentChange => self.race_conflict(&target, &request, operation_id),
            error => error,
        })
    }

    pub fn create_file(
        &self,
        path: &WorkspacePath,
        bytes: &[u8],
        actor: MutationActor,
        correlation_id: impl Into<String>,
        requested_operation_id: Option<String>,
    ) -> Result<MutationResult, MutationError> {
        let target = self.checked_path(path)?;
        let current = self.read_state(&target)?;
        if current.exists {
            return Err(MutationError::AlreadyExists);
        }
        let operation_id = operation_id(requested_operation_id.as_deref());
        self.commit_bytes(
            path,
            &target,
            bytes,
            None,
            operation_id,
            actor,
            correlation_id.into(),
            None,
            false,
        )
    }

    pub fn create_attachment(
        &self,
        path: &WorkspacePath,
        bytes: &[u8],
        actor: MutationActor,
        correlation_id: impl Into<String>,
    ) -> Result<MutationResult, MutationError> {
        self.create_file(path, bytes, actor, correlation_id, None)
    }

    pub fn copy(
        &self,
        source: &WorkspacePath,
        destination: &WorkspacePath,
        actor: MutationActor,
        correlation_id: impl Into<String>,
    ) -> Result<MutationResult, MutationError> {
        let source_path = self.checked_path(source)?;
        let destination_path = self.checked_path(destination)?;
        let source_state = self.read_state(&source_path)?;
        if !source_state.exists {
            return Err(MutationError::NotFound);
        }
        if source_state.is_directory {
            return Err(MutationError::Io(
                "recursive directory copy is not enabled".into(),
            ));
        }
        if self.read_state(&destination_path)?.exists {
            return Err(MutationError::AlreadyExists);
        }
        self.commit_bytes(
            destination,
            &destination_path,
            &source_state.bytes,
            None,
            operation_id(None),
            actor,
            correlation_id.into(),
            Some(source.clone()),
            false,
        )
    }

    /// Renames on one volume atomically.  Cross-volume file moves use a
    /// verified destination copy and remove the source only after success;
    /// directories fail closed because recursive copy needs an explicit policy.
    pub fn rename(
        &self,
        source: &WorkspacePath,
        destination: &WorkspacePath,
        actor: MutationActor,
        correlation_id: impl Into<String>,
    ) -> Result<MutationResult, MutationError> {
        let source_path = self.checked_path(source)?;
        let destination_path = self.checked_path(destination)?;
        let source_state = self.read_state(&source_path)?;
        if !source_state.exists {
            return Err(MutationError::NotFound);
        }
        let case_only = same_case_insensitive_path(&source_path, &destination_path);
        if self.read_state(&destination_path)?.exists && !case_only {
            return Err(MutationError::AlreadyExists);
        }
        let operation_id = operation_id(None);
        if case_only {
            let intermediary = temporary_path(
                source_path
                    .parent()
                    .ok_or_else(|| MutationError::InvalidPath("source has no parent".into()))?,
                &destination_path,
                &operation_id,
            );
            fs::rename(&source_path, &intermediary)?;
            return match fs::rename(&intermediary, &destination_path) {
                Ok(()) => Ok(MutationResult {
                    operation_id,
                    revision_id: Ulid::new().to_string(),
                    content_hash: source_state.hash,
                    size_bytes: source_state.bytes.len() as u64,
                    source_path: Some(source.clone()),
                    target_path: destination.clone(),
                    non_atomic: false,
                    merge_notice: false,
                    correlation_id: correlation_id.into(),
                    actor,
                }),
                Err(error) => {
                    let _ = fs::rename(&intermediary, &source_path);
                    Err(error.into())
                }
            };
        }

        if source_state.is_directory {
            fs::rename(&source_path, &destination_path)?;
            return Ok(MutationResult {
                operation_id,
                revision_id: Ulid::new().to_string(),
                content_hash: None,
                size_bytes: 0,
                source_path: Some(source.clone()),
                target_path: destination.clone(),
                non_atomic: false,
                merge_notice: false,
                correlation_id: correlation_id.into(),
                actor,
            });
        }

        match fs::rename(&source_path, &destination_path) {
            Ok(()) => Ok(MutationResult {
                operation_id,
                revision_id: Ulid::new().to_string(),
                content_hash: source_state.hash,
                size_bytes: source_state.bytes.len() as u64,
                source_path: Some(source.clone()),
                target_path: destination.clone(),
                non_atomic: false,
                merge_notice: false,
                correlation_id: correlation_id.into(),
                actor,
            }),
            Err(error) if is_cross_volume(&error) => {
                let result = self.commit_bytes(
                    destination,
                    &destination_path,
                    &source_state.bytes,
                    None,
                    operation_id,
                    actor.clone(),
                    correlation_id.into(),
                    Some(source.clone()),
                    true,
                )?;
                let source_after_copy = self.read_state(&source_path)?;
                if source_after_copy.hash != source_state.hash {
                    let _ = fs::remove_file(&destination_path);
                    return Err(MutationError::ConcurrentChange);
                }
                fs::remove_file(&source_path)?;
                Ok(result)
            }
            Err(error) => Err(error.into()),
        }
    }

    pub fn move_path(
        &self,
        source: &WorkspacePath,
        destination: &WorkspacePath,
        actor: MutationActor,
        correlation_id: impl Into<String>,
    ) -> Result<MutationResult, MutationError> {
        self.rename(source, destination, actor, correlation_id)
    }

    pub fn trash(
        &self,
        path: &WorkspacePath,
        actor: MutationActor,
        correlation_id: impl Into<String>,
    ) -> Result<MutationResult, MutationError> {
        let target = self.checked_path(path)?;
        let state = self.read_state(&target)?;
        if !state.exists {
            return Err(MutationError::NotFound);
        }
        self.trash
            .move_to_trash(&target)
            .map_err(|_| MutationError::TrashUnavailable)?;
        Ok(MutationResult {
            operation_id: operation_id(None),
            revision_id: Ulid::new().to_string(),
            content_hash: state.hash,
            size_bytes: state.bytes.len() as u64,
            source_path: Some(path.clone()),
            target_path: path.clone(),
            non_atomic: false,
            merge_notice: false,
            correlation_id: correlation_id.into(),
            actor,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn commit_text(
        &self,
        path: &WorkspacePath,
        target: &Path,
        content: &str,
        expected_hash: Option<&str>,
        operation_id: String,
        merge_notice: bool,
        request: &WriteTextRequest,
    ) -> Result<MutationResult, MutationError> {
        self.commit_bytes(
            path,
            target,
            content.as_bytes(),
            expected_hash,
            operation_id,
            request.actor.clone(),
            request.correlation_id.clone(),
            None,
            false,
        )
        .map(|mut result| {
            result.merge_notice = merge_notice;
            result
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn commit_bytes(
        &self,
        target_reference: &WorkspacePath,
        target: &Path,
        bytes: &[u8],
        expected_hash: Option<&str>,
        operation_id: String,
        actor: MutationActor,
        correlation_id: String,
        source_path: Option<WorkspacePath>,
        non_atomic: bool,
    ) -> Result<MutationResult, MutationError> {
        let before = self.read_state(target)?;
        match expected_hash {
            Some(expected) if before.hash.as_deref() != Some(expected) => {
                return Err(MutationError::ConcurrentChange);
            }
            None if before.exists => return Err(MutationError::ConcurrentChange),
            _ => {}
        }
        let parent = target
            .parent()
            .ok_or_else(|| MutationError::InvalidPath("destination has no parent".into()))?;
        fs::create_dir_all(parent)?;
        let temp_path = temporary_path(parent, target, &operation_id);
        let mut temp = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        let write_result = (|| -> io::Result<()> {
            temp.write_all(bytes)?;
            temp.flush()?;
            temp.sync_all()?;
            if let Some(permissions) = before.permissions {
                fs::set_permissions(&temp_path, permissions)?;
            }
            drop(temp);
            fs::rename(&temp_path, target)
        })();
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temp_path);
            return Err(error.into());
        }
        Ok(MutationResult {
            operation_id,
            revision_id: Ulid::new().to_string(),
            content_hash: Some(hash_bytes(bytes)),
            size_bytes: bytes.len() as u64,
            source_path,
            target_path: target_reference.clone(),
            non_atomic,
            merge_notice: false,
            correlation_id,
            actor,
        })
    }

    fn checked_path(&self, path: &WorkspacePath) -> Result<PathBuf, MutationError> {
        if path.workspace_id != self.workspace_id {
            return Err(MutationError::WorkspaceMismatch);
        }
        validate_relative_path(&path.relative_path)?;
        let candidate = self.root.join(Path::new(&path.relative_path));
        let parent = nearest_existing_parent(&candidate).ok_or(MutationError::NotFound)?;
        let canonical_parent = fs::canonicalize(parent)?;
        if !canonical_parent.starts_with(&self.canonical_root) {
            return Err(MutationError::PathEscape);
        }
        if let Ok(metadata) = fs::symlink_metadata(&candidate) {
            if metadata.file_type().is_symlink() {
                let canonical =
                    fs::canonicalize(&candidate).map_err(|_| MutationError::PathEscape)?;
                if !canonical.starts_with(&self.canonical_root) {
                    return Err(MutationError::PathEscape);
                }
            } else if metadata.is_dir() && !canonical_parent.starts_with(&self.canonical_root) {
                return Err(MutationError::PathEscape);
            }
        }
        Ok(candidate)
    }

    fn read_state(&self, path: &Path) -> Result<FileState, MutationError> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(FileState::missing());
            }
            Err(error) => return Err(error.into()),
        };
        if metadata.is_dir() {
            return Ok(FileState {
                exists: true,
                hash: None,
                content: None,
                bytes: Vec::new(),
                binary: false,
                permissions: Some(metadata.permissions()),
                is_directory: true,
            });
        }
        let bytes = fs::read(path)?;
        let content = std::str::from_utf8(&bytes).ok().map(ToOwned::to_owned);
        Ok(FileState {
            exists: true,
            hash: Some(hash_bytes(&bytes)),
            content,
            binary: std::str::from_utf8(&bytes).is_err(),
            bytes,
            permissions: Some(metadata.permissions()),
            is_directory: false,
        })
    }

    fn race_conflict(
        &self,
        target: &Path,
        request: &WriteTextRequest,
        operation_id: String,
    ) -> MutationError {
        let disk = self
            .read_state(target)
            .unwrap_or_else(|_| FileState::missing());
        MutationError::Conflict(Box::new(ConflictResult {
            kind: if !disk.exists {
                ConflictKind::DeletedOnDisk
            } else if disk.binary {
                ConflictKind::BinaryOnDisk
            } else {
                ConflictKind::ConcurrentChange
            },
            base: TextState {
                exists: request.base_hash.is_some(),
                hash: request.base_hash.clone(),
                content: request.base_content.clone(),
                binary: false,
            },
            disk: disk.as_text_state(),
            editor: text_state(&request.content),
            clean_merge: None,
            operation_id,
            correlation_id: request.correlation_id.clone(),
            actor: request.actor.clone(),
        }))
    }
}

fn operation_id(value: Option<&str>) -> String {
    value
        .filter(|id| !id.is_empty())
        .map_or_else(|| Ulid::new().to_string(), ToOwned::to_owned)
}

fn hash_bytes(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

fn text_state(content: &str) -> TextState {
    TextState {
        exists: true,
        hash: Some(hash_bytes(content.as_bytes())),
        content: Some(content.to_owned()),
        binary: false,
    }
}

fn validate_relative_path(relative: &str) -> Result<(), MutationError> {
    if relative.is_empty()
        || relative.starts_with('/')
        || relative.starts_with('\\')
        || relative.contains('\\')
        || relative.bytes().any(|byte| byte == 0)
    {
        return Err(MutationError::InvalidPath(relative.into()));
    }
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir
            | Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_) => {
                return Err(MutationError::InvalidPath(relative.into()));
            }
        }
    }
    Ok(())
}

fn nearest_existing_parent(path: &Path) -> Option<&Path> {
    let mut current = path;
    while !current.exists() {
        current = current.parent()?;
    }
    Some(current)
}

fn temporary_path(parent: &Path, target: &Path, operation_id: &str) -> PathBuf {
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let safe_operation = operation_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect::<String>();
    parent.join(format!(".{name}.agent-os-{safe_operation}.tmp"))
}

fn is_cross_volume(error: &io::Error) -> bool {
    error.raw_os_error() == Some(18)
}

fn same_case_insensitive_path(source: &Path, destination: &Path) -> bool {
    if source == destination || source.parent() != destination.parent() {
        return false;
    }
    source
        .file_name()
        .zip(destination.file_name())
        .map(|(source, destination)| {
            source
                .to_string_lossy()
                .eq_ignore_ascii_case(&destination.to_string_lossy())
        })
        .unwrap_or(false)
}

#[derive(Debug, Clone)]
struct Hunk {
    start: usize,
    end: usize,
    replacement: Vec<String>,
}

/// A deliberately small line-based three-way merge.  `O(n*m)` LCS is
/// sufficient for source-editor-sized files; large files are routed away by
/// the later viewer checkpoint.
fn three_way_merge(base: &str, disk: &str, editor: &str) -> Option<String> {
    if disk == base {
        return Some(editor.to_owned());
    }
    if editor == base || disk == editor {
        return Some(disk.to_owned());
    }
    let base_lines = split_lines(base);
    let disk_hunks = diff_hunks(&base_lines, &split_lines(disk));
    let editor_hunks = diff_hunks(&base_lines, &split_lines(editor));
    merge_hunks(&base_lines, &disk_hunks, &editor_hunks)
}

fn split_lines(value: &str) -> Vec<String> {
    if value.is_empty() {
        Vec::new()
    } else {
        value.split_inclusive('\n').map(ToOwned::to_owned).collect()
    }
}

fn diff_hunks(base: &[String], changed: &[String]) -> Vec<Hunk> {
    let width = changed.len() + 1;
    let mut lcs = vec![0usize; (base.len() + 1) * width];
    for i in (0..base.len()).rev() {
        for j in (0..changed.len()).rev() {
            lcs[i * width + j] = if base[i] == changed[j] {
                1 + lcs[(i + 1) * width + j + 1]
            } else {
                lcs[(i + 1) * width + j].max(lcs[i * width + j + 1])
            };
        }
    }
    let mut hunks = Vec::new();
    let mut i = 0;
    let mut j = 0;
    let mut start = None;
    let mut replacement = Vec::new();
    while i < base.len() || j < changed.len() {
        if i < base.len() && j < changed.len() && base[i] == changed[j] {
            if let Some(hunk_start) = start.take() {
                hunks.push(Hunk {
                    start: hunk_start,
                    end: i,
                    replacement: std::mem::take(&mut replacement),
                });
            }
            i += 1;
            j += 1;
        } else {
            start.get_or_insert(i);
            if j < changed.len()
                && (i == base.len() || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])
            {
                replacement.push(changed[j].clone());
                j += 1;
            } else {
                i += 1;
            }
        }
    }
    if let Some(hunk_start) = start {
        hunks.push(Hunk {
            start: hunk_start,
            end: i,
            replacement,
        });
    }
    hunks
}

fn merge_hunks(base: &[String], disk: &[Hunk], editor: &[Hunk]) -> Option<String> {
    let mut output = Vec::new();
    let mut cursor = 0;
    let mut disk_index = 0;
    let mut editor_index = 0;
    while disk_index < disk.len() || editor_index < editor.len() {
        let disk_hunk = disk.get(disk_index);
        let editor_hunk = editor.get(editor_index);
        match (disk_hunk, editor_hunk) {
            (Some(disk_hunk), Some(editor_hunk))
                if disk_hunk.start == editor_hunk.start
                    && disk_hunk.end == editor_hunk.end
                    && disk_hunk.replacement == editor_hunk.replacement =>
            {
                output.extend_from_slice(&base[cursor..disk_hunk.start]);
                output.extend(disk_hunk.replacement.clone());
                cursor = disk_hunk.end;
                disk_index += 1;
                editor_index += 1;
            }
            (Some(disk_hunk), Some(editor_hunk)) if disk_hunk.end <= editor_hunk.start => {
                output.extend_from_slice(&base[cursor..disk_hunk.start]);
                output.extend(disk_hunk.replacement.clone());
                cursor = disk_hunk.end;
                disk_index += 1;
            }
            (Some(disk_hunk), Some(editor_hunk)) if editor_hunk.end <= disk_hunk.start => {
                output.extend_from_slice(&base[cursor..editor_hunk.start]);
                output.extend(editor_hunk.replacement.clone());
                cursor = editor_hunk.end;
                editor_index += 1;
            }
            (Some(_), Some(_)) => return None,
            (Some(disk_hunk), None) => {
                output.extend_from_slice(&base[cursor..disk_hunk.start]);
                output.extend(disk_hunk.replacement.clone());
                cursor = disk_hunk.end;
                disk_index += 1;
            }
            (None, Some(editor_hunk)) => {
                output.extend_from_slice(&base[cursor..editor_hunk.start]);
                output.extend(editor_hunk.replacement.clone());
                cursor = editor_hunk.end;
                editor_index += 1;
            }
            (None, None) => break,
        }
    }
    output.extend_from_slice(&base[cursor..]);
    Some(output.concat())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::trash::RecordingTrash;

    #[test]
    fn merges_disjoint_external_edits() {
        let merged = three_way_merge("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n");
        assert_eq!(merged.as_deref(), Some("A\nb\nC\n"));
    }

    #[test]
    fn overlapping_external_edits_conflict() {
        assert!(three_way_merge("a\nb\n", "A\nb\n", "B\nb\n").is_none());
    }

    #[test]
    fn write_requires_base_hash_for_existing_file() {
        let directory = tempfile::tempdir().expect("tempdir");
        let service = MutationService::new("ws", directory.path()).expect("service");
        let path = WorkspacePath::new("ws", "note.txt");
        service
            .create_file(&path, b"old", MutationActor::user("test"), "corr", None)
            .expect("create");
        let error = service
            .write_text(&path, WriteTextRequest::new("new", None))
            .expect_err("base hash required");
        assert!(matches!(error, MutationError::BaseHashRequired));
    }

    #[test]
    fn failed_trash_adapter_is_fail_closed() {
        let directory = tempfile::tempdir().expect("tempdir");
        let service = MutationService::new("ws", directory.path()).expect("service");
        let path = WorkspacePath::new("ws", "note.txt");
        service
            .create_file(&path, b"note", MutationActor::user("test"), "corr", None)
            .expect("create");
        assert!(matches!(
            service.trash(&path, MutationActor::user("test"), "corr"),
            Err(MutationError::TrashUnavailable)
        ));
        let recording = RecordingTrash::default();
        let service = MutationService::with_trash("ws", directory.path(), recording.clone())
            .expect("service");
        service
            .trash(&path, MutationActor::user("test"), "corr")
            .expect("trash");
        assert_eq!(recording.paths(), vec![directory.path().join("note.txt")]);
    }
}
