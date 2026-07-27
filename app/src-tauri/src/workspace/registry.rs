use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::trust::TrustLevel;

/// Stable application identity for a registered workspace.
#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct WorkspaceId(String);

impl WorkspaceId {
    #[must_use]
    pub fn new() -> Self {
        Self(format!("ws_{}", ulid::Ulid::new()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for WorkspaceId {
    fn default() -> Self {
        Self::new()
    }
}

impl From<String> for WorkspaceId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for WorkspaceId {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

impl fmt::Display for WorkspaceId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceKind {
    Brain,
    Project,
    Collection,
}

impl Default for WorkspaceKind {
    fn default() -> Self {
        Self::Brain
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RegisterWorkspace {
    pub id: Option<WorkspaceId>,
    pub name: String,
    pub kind: WorkspaceKind,
    /// A collection is virtual and therefore has no root.  Brain and project
    /// workspaces must provide an existing directory.
    pub display_root: Option<PathBuf>,
    pub trust_level: Option<TrustLevel>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WorkspaceRecord {
    pub id: WorkspaceId,
    pub name: String,
    pub kind: WorkspaceKind,
    pub display_root: Option<String>,
    pub canonical_root: Option<String>,
    pub manifest_path: Option<String>,
    pub trust_level: TrustLevel,
    pub index_enabled: bool,
    pub deleted: bool,
}

impl WorkspaceRecord {
    #[must_use]
    pub fn root_path(&self) -> Option<&Path> {
        self.canonical_root.as_deref().map(Path::new)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorkspaceError {
    InvalidName,
    MissingRoot,
    RootNotFound(PathBuf),
    RootNotDirectory(PathBuf),
    RootCanonicalization { path: PathBuf, message: String },
    DuplicateRoot(WorkspaceId),
    DuplicateId(WorkspaceId),
    NotFound(WorkspaceId),
    Deleted(WorkspaceId),
    Unavailable(WorkspaceId),
    CollectionHasRoot,
    PhysicalWorkspaceNeedsRoot,
}

impl fmt::Display for WorkspaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidName => formatter.write_str("workspace name is empty or too long"),
            Self::MissingRoot => formatter.write_str("a physical workspace requires a root"),
            Self::RootNotFound(path) => write!(
                formatter,
                "workspace root does not exist: {}",
                path.display()
            ),
            Self::RootNotDirectory(path) => write!(
                formatter,
                "workspace root is not a directory: {}",
                path.display()
            ),
            Self::RootCanonicalization { path, message } => {
                write!(
                    formatter,
                    "cannot canonicalize workspace root {}: {message}",
                    path.display()
                )
            }
            Self::DuplicateRoot(id) => {
                write!(formatter, "workspace root is already registered as {id}")
            }
            Self::DuplicateId(id) => write!(formatter, "workspace id {id} is already registered"),
            Self::NotFound(id) => write!(formatter, "workspace {id} was not found"),
            Self::Deleted(id) => write!(formatter, "workspace {id} is no longer registered"),
            Self::Unavailable(id) => write!(formatter, "workspace {id} is unavailable"),
            Self::CollectionHasRoot => {
                formatter.write_str("collection workspaces cannot have a filesystem root")
            }
            Self::PhysicalWorkspaceNeedsRoot => {
                formatter.write_str("brain and project workspaces require a filesystem root")
            }
        }
    }
}

impl std::error::Error for WorkspaceError {}

/// In-memory registry used by the application adapter and deterministic tests.
/// Persistence adapters can serialize [`WorkspaceRecord`] values without
/// allowing this module to depend on SQLite.
#[derive(Clone, Debug, Default)]
pub struct WorkspaceRegistry {
    records: BTreeMap<WorkspaceId, WorkspaceRecord>,
}

impl WorkspaceRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &mut self,
        request: RegisterWorkspace,
    ) -> Result<WorkspaceRecord, WorkspaceError> {
        if request.name.trim().is_empty() || request.name.chars().count() > 200 {
            return Err(WorkspaceError::InvalidName);
        }
        let requested_id = request.id.clone().unwrap_or_default();
        if self.records.contains_key(&requested_id) {
            return Err(WorkspaceError::DuplicateId(requested_id));
        }

        match request.kind {
            WorkspaceKind::Collection => {
                if request.display_root.is_some() {
                    return Err(WorkspaceError::CollectionHasRoot);
                }
                let record = WorkspaceRecord {
                    id: requested_id,
                    name: request.name,
                    kind: request.kind,
                    display_root: None,
                    canonical_root: None,
                    manifest_path: None,
                    trust_level: request.trust_level.unwrap_or_default(),
                    index_enabled: false,
                    deleted: false,
                };
                self.records.insert(record.id.clone(), record.clone());
                Ok(record)
            }
            WorkspaceKind::Brain | WorkspaceKind::Project => {
                let display_root = request.display_root.ok_or(WorkspaceError::MissingRoot)?;
                let canonical_root = canonical_directory(&display_root)?;
                let key = path_key(&canonical_root);
                if let Some(existing) = self.records.values().find(|record| {
                    !record.deleted
                        && record
                            .canonical_root
                            .as_deref()
                            .is_some_and(|root| path_key(Path::new(root)) == key)
                }) {
                    return Err(WorkspaceError::DuplicateRoot(existing.id.clone()));
                }
                let id = requested_id;
                let record = WorkspaceRecord {
                    id: id.clone(),
                    name: request.name,
                    kind: request.kind,
                    display_root: Some(display_root.to_string_lossy().into_owned()),
                    canonical_root: Some(canonical_root.to_string_lossy().into_owned()),
                    manifest_path: Some(
                        canonical_root
                            .join("brain.workspace.yaml")
                            .to_string_lossy()
                            .into_owned(),
                    ),
                    trust_level: request.trust_level.unwrap_or_default(),
                    index_enabled: true,
                    deleted: false,
                };
                self.records.insert(id, record.clone());
                Ok(record)
            }
        }
    }

    pub fn get(&self, id: &WorkspaceId) -> Result<&WorkspaceRecord, WorkspaceError> {
        let record = self
            .records
            .get(id)
            .ok_or_else(|| WorkspaceError::NotFound(id.clone()))?;
        if record.deleted {
            return Err(WorkspaceError::Deleted(id.clone()));
        }
        Ok(record)
    }

    pub fn open(&self, id: &WorkspaceId) -> Result<&WorkspaceRecord, WorkspaceError> {
        let record = self.get(id)?;
        if let Some(root) = record.root_path() {
            let canonical =
                fs::canonicalize(root).map_err(|_| WorkspaceError::Unavailable(id.clone()))?;
            if !canonical.is_dir() {
                return Err(WorkspaceError::Unavailable(id.clone()));
            }
        }
        Ok(record)
    }

    /// Removes only the registration.  The root and every user file remain untouched.
    pub fn remove(&mut self, id: &WorkspaceId) -> Result<WorkspaceRecord, WorkspaceError> {
        let record = self
            .records
            .get_mut(id)
            .ok_or_else(|| WorkspaceError::NotFound(id.clone()))?;
        if record.deleted {
            return Err(WorkspaceError::Deleted(id.clone()));
        }
        record.deleted = true;
        Ok(record.clone())
    }

    pub fn restore(&mut self, id: &WorkspaceId) -> Result<WorkspaceRecord, WorkspaceError> {
        let record = self
            .records
            .get_mut(id)
            .ok_or_else(|| WorkspaceError::NotFound(id.clone()))?;
        if !record.deleted {
            return Ok(record.clone());
        }
        if let Some(root) = record.root_path() {
            let canonical =
                fs::canonicalize(root).map_err(|_| WorkspaceError::Unavailable(id.clone()))?;
            if path_key(&canonical) != path_key(root) || !canonical.is_dir() {
                return Err(WorkspaceError::Unavailable(id.clone()));
            }
        }
        record.deleted = false;
        Ok(record.clone())
    }

    pub fn records(&self) -> impl Iterator<Item = &WorkspaceRecord> {
        self.records.values().filter(|record| !record.deleted)
    }
}

fn canonical_directory(path: &Path) -> Result<PathBuf, WorkspaceError> {
    let metadata = fs::metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            WorkspaceError::RootNotFound(path.to_owned())
        } else {
            WorkspaceError::RootCanonicalization {
                path: path.to_owned(),
                message: error.to_string(),
            }
        }
    })?;
    if !metadata.is_dir() {
        return Err(WorkspaceError::RootNotDirectory(path.to_owned()));
    }
    fs::canonicalize(path).map_err(|error| WorkspaceError::RootCanonicalization {
        path: path.to_owned(),
        message: error.to_string(),
    })
}

/// A conservative cross-platform comparison key.  Canonicalization handles
/// aliases; case folding covers the default case-insensitive macOS/Windows
/// volumes.  A platform adapter can replace this with file IDs later.
#[must_use]
pub fn path_key(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_canonical_roots_are_rejected() {
        let temp = tempfile::tempdir().expect("tempdir");
        let nested = temp.path().join("nested");
        std::fs::create_dir(&nested).expect("nested");
        let alias = nested.join("..").join("nested");
        let mut registry = WorkspaceRegistry::new();
        registry
            .register(RegisterWorkspace {
                id: Some(WorkspaceId::from("ws_first")),
                name: "First".into(),
                kind: WorkspaceKind::Project,
                display_root: Some(nested.clone()),
                trust_level: None,
            })
            .expect("first registration");
        let duplicate = registry.register(RegisterWorkspace {
            id: Some(WorkspaceId::from("ws_second")),
            name: "Second".into(),
            kind: WorkspaceKind::Project,
            display_root: Some(alias),
            trust_level: None,
        });
        assert!(matches!(duplicate, Err(WorkspaceError::DuplicateRoot(_))));
    }

    #[test]
    fn remove_keeps_root_and_marks_only_registration() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().to_owned();
        std::fs::write(root.join("keep.txt"), "keep").expect("file");
        let mut registry = WorkspaceRegistry::new();
        let record = registry
            .register(RegisterWorkspace {
                id: Some(WorkspaceId::from("ws_remove")),
                name: "Remove".into(),
                kind: WorkspaceKind::Brain,
                display_root: Some(root.clone()),
                trust_level: None,
            })
            .expect("registration");
        registry.remove(&record.id).expect("remove registration");
        assert!(root.join("keep.txt").is_file());
        assert!(matches!(
            registry.get(&record.id),
            Err(WorkspaceError::Deleted(_))
        ));
    }
}
