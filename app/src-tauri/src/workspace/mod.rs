//! Workspace registration, policy, and read-side filesystem primitives.
//!
//! The workspace module deliberately has no database or Tauri dependency.  The
//! application layer owns persistence and IPC; these types are the small,
//! serializable boundary those adapters use.

mod discovery;
pub mod git;
mod ignore_policy;
mod manifest;
pub mod mutations;
mod path_policy;
mod reader;
mod registry;
pub mod trash;
mod trust;
pub mod watcher;

pub use discovery::{DirectoryEntry, DirectoryPage, DiscoveryError, FileKind, list_directory};
pub use ignore_policy::{AccessLayer, IgnoreDecision, IgnoreError, IgnorePolicy};
pub use manifest::{
    AgentSettings, IndexSettings, ManifestError, SecurityPolicy, TerminalSettings,
    WorkspaceManifest, load_manifest, parse_manifest, validate_for_workspace,
};
pub use path_policy::{
    PathPolicy, PathPolicyError, SymlinkPolicy, ValidatedWorkspacePath, WorkspacePath,
};
pub use reader::{FileDescriptor, ReadError, TextRead, open_file, open_validated, read_text};
pub use registry::{
    RegisterWorkspace, WorkspaceError, WorkspaceId, WorkspaceKind, WorkspaceRecord,
    WorkspaceRegistry,
};
pub use trust::{
    ApplicationPolicy, CapabilitySummary, EffectivePolicy, TrustLevel, evaluate_policy,
};
