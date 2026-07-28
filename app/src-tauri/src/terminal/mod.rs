//! Workspace-scoped terminal state and the platform PTY boundary.
//!
//! The native adapter lives in [`native`] and keeps PTY handles behind this
//! workspace-scoped manager.

use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::workspace::{
    EffectivePolicy, PathPolicy, PathPolicyError, WorkspacePath, WorkspaceRecord,
};

pub mod native;
pub use native::{NativePtyAdapter, NativePtyEvent};

pub const MAX_SESSIONS_PER_WORKSPACE: usize = 6;
pub const DEFAULT_OUTPUT_CAPACITY: usize = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct TerminalId(String);

impl TerminalId {
    #[must_use]
    pub fn new() -> Self {
        Self(format!("term_{}", ulid::Ulid::new()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for TerminalId {
    fn default() -> Self {
        Self::new()
    }
}

impl From<&str> for TerminalId {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PresetId {
    Zsh,
    Bash,
    Fish,
    PowerShell,
    Codex,
    Claude,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TerminalPreset {
    pub id: PresetId,
    pub label: &'static str,
    pub executable: &'static str,
    pub args: &'static [&'static str],
    pub protected: bool,
}

impl PresetId {
    /// Presets are backend-owned fixed argument arrays. Renderer-provided
    /// executables, arguments, and shell interpolation never enter this path.
    #[must_use]
    pub const fn definition(self) -> TerminalPreset {
        match self {
            Self::Zsh => TerminalPreset {
                id: self,
                label: "Zsh",
                executable: "zsh",
                args: &["-l"],
                protected: false,
            },
            Self::Bash => TerminalPreset {
                id: self,
                label: "Bash",
                executable: "bash",
                args: &["-l"],
                protected: false,
            },
            Self::Fish => TerminalPreset {
                id: self,
                label: "Fish",
                executable: "fish",
                args: &["-l"],
                protected: false,
            },
            Self::PowerShell => TerminalPreset {
                id: self,
                label: "PowerShell",
                executable: "pwsh",
                args: &["-NoLogo"],
                protected: false,
            },
            Self::Codex => TerminalPreset {
                id: self,
                label: "Codex",
                executable: "codex",
                args: &[],
                protected: true,
            },
            Self::Claude => TerminalPreset {
                id: self,
                label: "Claude",
                executable: "claude",
                args: &[],
                protected: true,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TerminalSize {
    pub columns: u16,
    pub rows: u16,
}

impl TerminalSize {
    fn validate(self) -> Result<Self, TerminalError> {
        if self.columns == 0 || self.rows == 0 {
            Err(TerminalError::InvalidSize)
        } else {
            Ok(self)
        }
    }
}

#[derive(Clone, Debug)]
pub struct SpawnRequest {
    pub terminal_id: TerminalId,
    pub executable: &'static str,
    pub args: &'static [&'static str],
    pub cwd: PathBuf,
    pub size: TerminalSize,
}

/// Minimal native-PTY seam. Implementations must keep each handle private and
/// must not expose unrestricted process creation through IPC.
pub trait PtyAdapter {
    fn spawn(&mut self, request: &SpawnRequest) -> Result<(), String>;
    fn write(&mut self, terminal_id: &TerminalId, bytes: &[u8]) -> Result<(), String>;
    fn resize(&mut self, terminal_id: &TerminalId, size: TerminalSize) -> Result<(), String>;
    fn terminate(&mut self, terminal_id: &TerminalId) -> Result<(), String>;
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalStatus {
    Running,
    Exited,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CwdState {
    pub relative_path: String,
    pub reliable: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: TerminalId,
    pub workspace_id: String,
    pub preset: PresetId,
    pub status: TerminalStatus,
    pub cwd: CwdState,
    pub size: TerminalSize,
    pub exit_code: Option<i32>,
    pub protected: bool,
    pub busy: bool,
    pub child_processes: usize,
    pub buffered_bytes: usize,
    pub dropped_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TerminalRestoreMetadata {
    pub workspace_id: String,
    pub preset: PresetId,
    pub relative_cwd: String,
    pub size: TerminalSize,
}

impl From<&TerminalSession> for TerminalRestoreMetadata {
    fn from(session: &TerminalSession) -> Self {
        Self {
            workspace_id: session.workspace_id.clone(),
            preset: session.preset,
            relative_cwd: session.cwd.relative_path.clone(),
            size: session.size,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputChunk {
    pub bytes: Vec<u8>,
    pub remaining_bytes: usize,
    pub dropped_bytes: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminationDecision {
    Allowed,
    ConfirmationRequired,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalEvent {
    Started(TerminalId),
    OutputAvailable {
        terminal_id: TerminalId,
        buffered_bytes: usize,
        dropped_bytes: u64,
    },
    CwdChanged {
        terminal_id: TerminalId,
        relative_path: String,
    },
    Exited {
        terminal_id: TerminalId,
        exit_code: Option<i32>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalError {
    TerminalDisabled,
    InvalidInitialCwd,
    InvalidSize,
    WorkspaceLimit,
    NotFound,
    WorkspaceMismatch,
    NotRunning,
    ConfirmationRequired,
    InvalidOsc7,
    CwdOutsideWorkspace,
    Path(String),
    Adapter(String),
}

impl fmt::Display for TerminalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TerminalDisabled => formatter.write_str("terminal access is disabled"),
            Self::InvalidInitialCwd => {
                formatter.write_str("the initial terminal path is not a directory")
            }
            Self::InvalidSize => formatter.write_str("terminal dimensions must be non-zero"),
            Self::WorkspaceLimit => formatter.write_str("workspace terminal limit reached"),
            Self::NotFound => formatter.write_str("terminal session not found"),
            Self::WorkspaceMismatch => formatter.write_str("terminal belongs to another workspace"),
            Self::NotRunning => formatter.write_str("terminal is not running"),
            Self::ConfirmationRequired => {
                formatter.write_str("terminating this process tree requires confirmation")
            }
            Self::InvalidOsc7 => formatter.write_str("invalid trusted OSC 7 report"),
            Self::CwdOutsideWorkspace => {
                formatter.write_str("reported terminal directory is outside the workspace")
            }
            Self::Path(message) => write!(formatter, "terminal path rejected: {message}"),
            Self::Adapter(message) => write!(formatter, "PTY adapter failed: {message}"),
        }
    }
}

impl std::error::Error for TerminalError {}

impl From<PathPolicyError> for TerminalError {
    fn from(error: PathPolicyError) -> Self {
        Self::Path(error.to_string())
    }
}

struct SessionState {
    public: TerminalSession,
    output: ByteRing,
}

pub struct TerminalManager<A> {
    adapter: A,
    sessions: HashMap<TerminalId, SessionState>,
    output_capacity: usize,
}

impl<A: PtyAdapter> TerminalManager<A> {
    #[must_use]
    pub fn new(adapter: A) -> Self {
        Self::with_output_capacity(adapter, DEFAULT_OUTPUT_CAPACITY)
    }

    #[must_use]
    pub fn with_output_capacity(adapter: A, output_capacity: usize) -> Self {
        Self {
            adapter,
            sessions: HashMap::new(),
            output_capacity,
        }
    }

    pub fn start(
        &mut self,
        workspace: &WorkspaceRecord,
        effective_policy: &EffectivePolicy,
        path_policy: &PathPolicy,
        initial_cwd: &WorkspacePath,
        preset: PresetId,
        size: TerminalSize,
    ) -> Result<TerminalEvent, TerminalError> {
        if !workspace.trust_level.capabilities().terminal || !effective_policy.capabilities.terminal
        {
            return Err(TerminalError::TerminalDisabled);
        }
        if workspace.id != initial_cwd.workspace_id {
            return Err(TerminalError::WorkspaceMismatch);
        }
        if self
            .sessions
            .values()
            .filter(|session| {
                session.public.workspace_id == workspace.id.as_str()
                    && session.public.status == TerminalStatus::Running
            })
            .count()
            >= MAX_SESSIONS_PER_WORKSPACE
        {
            return Err(TerminalError::WorkspaceLimit);
        }

        let size = size.validate()?;
        let cwd = resolve_initial_cwd(path_policy, workspace, initial_cwd)?;
        let definition = preset.definition();
        let terminal_id = TerminalId::new();
        self.adapter
            .spawn(&SpawnRequest {
                terminal_id: terminal_id.clone(),
                executable: definition.executable,
                args: definition.args,
                cwd,
                size,
            })
            .map_err(TerminalError::Adapter)?;

        self.sessions.insert(
            terminal_id.clone(),
            SessionState {
                public: TerminalSession {
                    id: terminal_id.clone(),
                    workspace_id: workspace.id.to_string(),
                    preset,
                    status: TerminalStatus::Running,
                    cwd: CwdState {
                        relative_path: initial_cwd.relative_path.clone(),
                        reliable: false,
                    },
                    size,
                    exit_code: None,
                    protected: definition.protected,
                    busy: false,
                    child_processes: 0,
                    buffered_bytes: 0,
                    dropped_bytes: 0,
                },
                output: ByteRing::new(self.output_capacity),
            },
        );
        Ok(TerminalEvent::Started(terminal_id))
    }

    pub fn session(
        &self,
        workspace_id: &str,
        terminal_id: &TerminalId,
    ) -> Result<&TerminalSession, TerminalError> {
        Ok(&self.scoped(workspace_id, terminal_id)?.public)
    }

    #[must_use]
    pub fn sessions(&self, workspace_id: &str) -> Vec<&TerminalSession> {
        self.sessions
            .values()
            .filter(|session| session.public.workspace_id == workspace_id)
            .map(|session| &session.public)
            .collect()
    }

    pub fn write(
        &mut self,
        workspace_id: &str,
        terminal_id: &TerminalId,
        bytes: &[u8],
    ) -> Result<(), TerminalError> {
        self.require_running(workspace_id, terminal_id)?;
        self.adapter
            .write(terminal_id, bytes)
            .map_err(TerminalError::Adapter)
    }

    pub fn resize(
        &mut self,
        workspace_id: &str,
        terminal_id: &TerminalId,
        size: TerminalSize,
    ) -> Result<(), TerminalError> {
        let size = size.validate()?;
        self.require_running(workspace_id, terminal_id)?;
        self.adapter
            .resize(terminal_id, size)
            .map_err(TerminalError::Adapter)?;
        self.scoped_mut(workspace_id, terminal_id)?.public.size = size;
        Ok(())
    }

    /// Accept raw bytes from the trusted native adapter. Output is never parsed
    /// for control state; shell integration reports use `report_trusted_osc7`.
    pub fn push_output(
        &mut self,
        workspace_id: &str,
        terminal_id: &TerminalId,
        bytes: &[u8],
    ) -> Result<TerminalEvent, TerminalError> {
        let state = self.scoped_mut(workspace_id, terminal_id)?;
        if state.public.status != TerminalStatus::Running {
            return Err(TerminalError::NotRunning);
        }
        state.output.push(bytes);
        state.public.buffered_bytes = state.output.len();
        state.public.dropped_bytes = state.output.dropped();
        Ok(TerminalEvent::OutputAvailable {
            terminal_id: terminal_id.clone(),
            buffered_bytes: state.public.buffered_bytes,
            dropped_bytes: state.public.dropped_bytes,
        })
    }

    pub fn read_output(
        &mut self,
        workspace_id: &str,
        terminal_id: &TerminalId,
        max_bytes: usize,
    ) -> Result<OutputChunk, TerminalError> {
        let state = self.scoped_mut(workspace_id, terminal_id)?;
        let bytes = state.output.drain(max_bytes);
        state.public.buffered_bytes = state.output.len();
        Ok(OutputChunk {
            bytes,
            remaining_bytes: state.output.len(),
            dropped_bytes: state.output.dropped(),
        })
    }

    /// This must only be called for data emitted by the installed shell hook,
    /// never by scanning untrusted terminal output.
    pub fn report_trusted_osc7(
        &mut self,
        workspace: &WorkspaceRecord,
        path_policy: &PathPolicy,
        terminal_id: &TerminalId,
        sequence: &[u8],
    ) -> Result<TerminalEvent, TerminalError> {
        self.require_running(workspace.id.as_str(), terminal_id)?;
        let absolute = parse_osc7(sequence)?;
        let relative = relative_workspace_directory(workspace, path_policy, &absolute)?;
        let state = self.scoped_mut(workspace.id.as_str(), terminal_id)?;
        state.public.cwd = CwdState {
            relative_path: relative.clone(),
            reliable: true,
        };
        Ok(TerminalEvent::CwdChanged {
            terminal_id: terminal_id.clone(),
            relative_path: relative,
        })
    }

    pub fn update_process_state(
        &mut self,
        workspace_id: &str,
        terminal_id: &TerminalId,
        busy: bool,
        child_processes: usize,
    ) -> Result<(), TerminalError> {
        let session = &mut self.scoped_mut(workspace_id, terminal_id)?.public;
        session.busy = busy;
        session.child_processes = child_processes;
        Ok(())
    }

    pub fn termination_decision(
        &self,
        workspace_id: &str,
        terminal_id: &TerminalId,
    ) -> Result<TerminationDecision, TerminalError> {
        let session = &self.scoped(workspace_id, terminal_id)?.public;
        if session.protected || session.busy || session.child_processes > 0 {
            Ok(TerminationDecision::ConfirmationRequired)
        } else {
            Ok(TerminationDecision::Allowed)
        }
    }

    pub fn terminate(
        &mut self,
        workspace_id: &str,
        terminal_id: &TerminalId,
        confirmed: bool,
    ) -> Result<(), TerminalError> {
        self.require_running(workspace_id, terminal_id)?;
        if !confirmed
            && self.termination_decision(workspace_id, terminal_id)?
                == TerminationDecision::ConfirmationRequired
        {
            return Err(TerminalError::ConfirmationRequired);
        }
        self.adapter
            .terminate(terminal_id)
            .map_err(TerminalError::Adapter)
    }

    pub fn mark_exited(
        &mut self,
        workspace_id: &str,
        terminal_id: &TerminalId,
        exit_code: Option<i32>,
    ) -> Result<TerminalEvent, TerminalError> {
        let session = &mut self.scoped_mut(workspace_id, terminal_id)?.public;
        session.status = TerminalStatus::Exited;
        session.exit_code = exit_code;
        session.busy = false;
        session.child_processes = 0;
        Ok(TerminalEvent::Exited {
            terminal_id: terminal_id.clone(),
            exit_code,
        })
    }

    pub fn terminate_workspace(
        &mut self,
        workspace_id: &str,
        confirmed: bool,
    ) -> Result<(), TerminalError> {
        let ids = self
            .sessions
            .values()
            .filter(|session| {
                session.public.workspace_id == workspace_id
                    && session.public.status == TerminalStatus::Running
            })
            .map(|session| session.public.id.clone())
            .collect::<Vec<_>>();
        for id in ids {
            self.terminate(workspace_id, &id, confirmed)?;
        }
        Ok(())
    }

    fn scoped(
        &self,
        workspace_id: &str,
        terminal_id: &TerminalId,
    ) -> Result<&SessionState, TerminalError> {
        let session = self
            .sessions
            .get(terminal_id)
            .ok_or(TerminalError::NotFound)?;
        if session.public.workspace_id != workspace_id {
            return Err(TerminalError::WorkspaceMismatch);
        }
        Ok(session)
    }

    fn scoped_mut(
        &mut self,
        workspace_id: &str,
        terminal_id: &TerminalId,
    ) -> Result<&mut SessionState, TerminalError> {
        let session = self
            .sessions
            .get_mut(terminal_id)
            .ok_or(TerminalError::NotFound)?;
        if session.public.workspace_id != workspace_id {
            return Err(TerminalError::WorkspaceMismatch);
        }
        Ok(session)
    }

    fn require_running(
        &self,
        workspace_id: &str,
        terminal_id: &TerminalId,
    ) -> Result<(), TerminalError> {
        if self.scoped(workspace_id, terminal_id)?.public.status == TerminalStatus::Running {
            Ok(())
        } else {
            Err(TerminalError::NotRunning)
        }
    }
}

impl TerminalManager<NativePtyAdapter> {
    pub fn poll_native_events(
        &mut self,
        limit: usize,
    ) -> Vec<Result<TerminalEvent, TerminalError>> {
        self.adapter
            .drain_events(limit)
            .into_iter()
            .map(|event| {
                let terminal_id = match &event {
                    NativePtyEvent::Output { terminal_id, .. }
                    | NativePtyEvent::Exited { terminal_id, .. } => terminal_id,
                };
                let workspace_id = self
                    .sessions
                    .get(terminal_id)
                    .ok_or(TerminalError::NotFound)?
                    .public
                    .workspace_id
                    .clone();
                match event {
                    NativePtyEvent::Output { terminal_id, bytes } => {
                        self.push_output(&workspace_id, &terminal_id, &bytes)
                    }
                    NativePtyEvent::Exited {
                        terminal_id,
                        exit_code,
                    } => self.mark_exited(&workspace_id, &terminal_id, exit_code),
                }
            })
            .collect()
    }
}

#[derive(Debug)]
struct ByteRing {
    bytes: VecDeque<u8>,
    capacity: usize,
    dropped: u64,
}

impl ByteRing {
    fn new(capacity: usize) -> Self {
        Self {
            bytes: VecDeque::with_capacity(capacity),
            capacity,
            dropped: 0,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        let overflow = self.bytes.len().saturating_add(bytes.len())
            - self
                .bytes
                .len()
                .saturating_add(bytes.len())
                .min(self.capacity);
        self.bytes.drain(..overflow.min(self.bytes.len()));
        let keep_from = bytes.len().saturating_sub(self.capacity);
        self.dropped = self.dropped.saturating_add(overflow as u64);
        self.bytes.extend(&bytes[keep_from..]);
    }

    fn drain(&mut self, max_bytes: usize) -> Vec<u8> {
        self.bytes
            .drain(..max_bytes.min(self.bytes.len()))
            .collect()
    }

    fn len(&self) -> usize {
        self.bytes.len()
    }

    fn dropped(&self) -> u64 {
        self.dropped
    }
}

pub fn resolve_initial_cwd(
    policy: &PathPolicy,
    workspace: &WorkspaceRecord,
    path: &WorkspacePath,
) -> Result<PathBuf, TerminalError> {
    let validated = policy.validate(workspace, path)?;
    if validated.canonical_path.is_dir() {
        Ok(validated.canonical_path)
    } else {
        Err(TerminalError::InvalidInitialCwd)
    }
}

fn relative_workspace_directory(
    workspace: &WorkspaceRecord,
    policy: &PathPolicy,
    absolute: &Path,
) -> Result<String, TerminalError> {
    let root = workspace
        .root_path()
        .ok_or(TerminalError::CwdOutsideWorkspace)?;
    let canonical_root =
        std::fs::canonicalize(root).map_err(|error| TerminalError::Path(error.to_string()))?;
    let canonical =
        std::fs::canonicalize(absolute).map_err(|error| TerminalError::Path(error.to_string()))?;
    let relative = canonical
        .strip_prefix(&canonical_root)
        .map_err(|_| TerminalError::CwdOutsideWorkspace)?;
    let relative = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    let path = WorkspacePath::new(workspace.id.clone(), relative.clone())?;
    if !policy.validate(workspace, &path)?.canonical_path.is_dir() {
        return Err(TerminalError::InvalidInitialCwd);
    }
    Ok(relative)
}

fn parse_osc7(sequence: &[u8]) -> Result<PathBuf, TerminalError> {
    if sequence.len() > 4096 || !sequence.starts_with(b"\x1b]7;file://") {
        return Err(TerminalError::InvalidOsc7);
    }
    let body = if sequence.ends_with(b"\x07") {
        &sequence[11..sequence.len() - 1]
    } else if sequence.ends_with(b"\x1b\\") {
        &sequence[11..sequence.len() - 2]
    } else {
        return Err(TerminalError::InvalidOsc7);
    };
    let slash = body
        .iter()
        .position(|byte| *byte == b'/')
        .ok_or(TerminalError::InvalidOsc7)?;
    if body[..slash]
        .iter()
        .any(|byte| byte.is_ascii_control() || *byte == b'\\')
    {
        return Err(TerminalError::InvalidOsc7);
    }
    let decoded = percent_decode(&body[slash..])?;
    let path = std::str::from_utf8(&decoded).map_err(|_| TerminalError::InvalidOsc7)?;
    if path.contains('\0') {
        return Err(TerminalError::InvalidOsc7);
    }
    Ok(PathBuf::from(path))
}

fn percent_decode(value: &[u8]) -> Result<Vec<u8>, TerminalError> {
    let mut decoded = Vec::with_capacity(value.len());
    let mut index = 0;
    while index < value.len() {
        if value[index] == b'%' {
            let hex = value
                .get(index + 1..index + 3)
                .ok_or(TerminalError::InvalidOsc7)?;
            let text = std::str::from_utf8(hex).map_err(|_| TerminalError::InvalidOsc7)?;
            decoded.push(u8::from_str_radix(text, 16).map_err(|_| TerminalError::InvalidOsc7)?);
            index += 3;
        } else {
            decoded.push(value[index]);
            index += 1;
        }
    }
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::{
        ApplicationPolicy, TrustLevel, WorkspaceId, WorkspaceKind, evaluate_policy,
    };
    use tempfile::TempDir;

    #[derive(Default)]
    struct MockPty {
        spawned: Vec<(TerminalId, String, Vec<String>, PathBuf)>,
        writes: Vec<Vec<u8>>,
        sizes: Vec<TerminalSize>,
        terminated: Vec<TerminalId>,
    }

    impl PtyAdapter for MockPty {
        fn spawn(&mut self, request: &SpawnRequest) -> Result<(), String> {
            self.spawned.push((
                request.terminal_id.clone(),
                request.executable.to_owned(),
                request.args.iter().map(|arg| (*arg).to_owned()).collect(),
                request.cwd.clone(),
            ));
            Ok(())
        }

        fn write(&mut self, _terminal_id: &TerminalId, bytes: &[u8]) -> Result<(), String> {
            self.writes.push(bytes.to_vec());
            Ok(())
        }

        fn resize(&mut self, _terminal_id: &TerminalId, size: TerminalSize) -> Result<(), String> {
            self.sizes.push(size);
            Ok(())
        }

        fn terminate(&mut self, terminal_id: &TerminalId) -> Result<(), String> {
            self.terminated.push(terminal_id.clone());
            Ok(())
        }
    }

    fn workspace(root: &Path, id: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: WorkspaceId::from(id),
            name: id.to_owned(),
            kind: WorkspaceKind::Project,
            display_root: Some(root.display().to_string()),
            canonical_root: Some(root.display().to_string()),
            manifest_path: None,
            trust_level: TrustLevel::Trusted,
            index_enabled: true,
            deleted: false,
        }
    }

    fn start(
        manager: &mut TerminalManager<MockPty>,
        workspace: &WorkspaceRecord,
        preset: PresetId,
    ) -> TerminalId {
        let policy = evaluate_policy(TrustLevel::Trusted, None, &ApplicationPolicy::default());
        match manager
            .start(
                workspace,
                &policy,
                &PathPolicy::default(),
                &WorkspacePath::root(workspace.id.clone()),
                preset,
                TerminalSize {
                    columns: 80,
                    rows: 24,
                },
            )
            .expect("start")
        {
            TerminalEvent::Started(id) => id,
            event => panic!("unexpected event: {event:?}"),
        }
    }

    #[test]
    fn enforces_workspace_scope_limit_and_fixed_preset() {
        let root = TempDir::new().expect("tempdir");
        let one = workspace(root.path(), "one");
        let two = workspace(root.path(), "two");
        let mut manager = TerminalManager::new(MockPty::default());
        let first = start(&mut manager, &one, PresetId::Zsh);
        for _ in 1..MAX_SESSIONS_PER_WORKSPACE {
            start(&mut manager, &one, PresetId::Zsh);
        }
        let policy = evaluate_policy(TrustLevel::Trusted, None, &ApplicationPolicy::default());
        assert_eq!(
            manager.start(
                &one,
                &policy,
                &PathPolicy::default(),
                &WorkspacePath::root(one.id.clone()),
                PresetId::Zsh,
                TerminalSize {
                    columns: 80,
                    rows: 24
                }
            ),
            Err(TerminalError::WorkspaceLimit)
        );
        start(&mut manager, &two, PresetId::Zsh);
        assert_eq!(
            manager.session(two.id.as_str(), &first),
            Err(TerminalError::WorkspaceMismatch)
        );
        assert_eq!(manager.adapter.spawned[0].1, "zsh");
        assert_eq!(manager.adapter.spawned[0].2, vec!["-l"]);
    }

    #[test]
    fn output_is_binary_safe_bounded_and_not_control_input() {
        let root = TempDir::new().expect("tempdir");
        let workspace = workspace(root.path(), "one");
        let mut manager = TerminalManager::with_output_capacity(MockPty::default(), 4);
        let id = start(&mut manager, &workspace, PresetId::Zsh);
        manager
            .push_output(workspace.id.as_str(), &id, &[0, 255, 1, 2, 3])
            .expect("push");
        let output = manager
            .read_output(workspace.id.as_str(), &id, 10)
            .expect("read");
        assert_eq!(output.bytes, vec![255, 1, 2, 3]);
        assert_eq!(output.dropped_bytes, 1);
        assert!(
            !manager
                .session(workspace.id.as_str(), &id)
                .unwrap()
                .cwd
                .reliable
        );
    }

    #[test]
    fn trusted_osc7_confirms_unicode_cwd_and_rejects_escape() {
        let root = TempDir::new().expect("tempdir");
        let child = root.path().join("a b-資料");
        std::fs::create_dir(&child).expect("mkdir");
        let workspace = workspace(root.path(), "one");
        let mut manager = TerminalManager::new(MockPty::default());
        let id = start(&mut manager, &workspace, PresetId::Zsh);
        let encoded = child
            .to_string_lossy()
            .replace(' ', "%20")
            .replace("資料", "%E8%B3%87%E6%96%99");
        let sequence = format!("\u{1b}]7;file://localhost{encoded}\u{7}");
        manager
            .report_trusted_osc7(&workspace, &PathPolicy::default(), &id, sequence.as_bytes())
            .expect("osc7");
        assert_eq!(
            manager.session(workspace.id.as_str(), &id).unwrap().cwd,
            CwdState {
                relative_path: "a b-資料".to_owned(),
                reliable: true
            }
        );

        let outside = TempDir::new().expect("outside");
        let sequence = format!("\u{1b}]7;file://localhost{}\u{7}", outside.path().display());
        assert_eq!(
            manager.report_trusted_osc7(
                &workspace,
                &PathPolicy::default(),
                &id,
                sequence.as_bytes()
            ),
            Err(TerminalError::CwdOutsideWorkspace)
        );
    }

    #[test]
    fn lifecycle_and_termination_protect_process_trees() {
        let root = TempDir::new().expect("tempdir");
        let workspace = workspace(root.path(), "one");
        let mut manager = TerminalManager::new(MockPty::default());
        let id = start(&mut manager, &workspace, PresetId::Codex);
        let shell = start(&mut manager, &workspace, PresetId::Zsh);
        manager
            .write(workspace.id.as_str(), &id, &[0, b'a'])
            .expect("write");
        manager
            .resize(
                workspace.id.as_str(),
                &id,
                TerminalSize {
                    columns: 100,
                    rows: 30,
                },
            )
            .expect("resize");
        assert_eq!(
            manager.terminate(workspace.id.as_str(), &id, false),
            Err(TerminalError::ConfirmationRequired)
        );
        manager
            .update_process_state(workspace.id.as_str(), &shell, true, 2)
            .expect("process state");
        assert_eq!(
            manager.termination_decision(workspace.id.as_str(), &shell),
            Ok(TerminationDecision::ConfirmationRequired)
        );
        manager
            .terminate(workspace.id.as_str(), &id, true)
            .expect("terminate");
        manager
            .mark_exited(workspace.id.as_str(), &id, Some(0))
            .expect("exit");
        assert_eq!(
            manager.write(workspace.id.as_str(), &id, b"late"),
            Err(TerminalError::NotRunning)
        );
        let session = manager.session(workspace.id.as_str(), &id).unwrap();
        assert_eq!(session.status, TerminalStatus::Exited);
        assert_eq!(session.exit_code, Some(0));
    }

    #[test]
    fn trust_and_initial_directory_are_enforced() {
        let root = TempDir::new().expect("tempdir");
        let file = root.path().join("note.md");
        std::fs::write(&file, "x").expect("write");
        let mut workspace = workspace(root.path(), "one");
        workspace.trust_level = TrustLevel::Untrusted;
        let policy = evaluate_policy(TrustLevel::Untrusted, None, &ApplicationPolicy::default());
        let mut manager = TerminalManager::new(MockPty::default());
        assert_eq!(
            manager.start(
                &workspace,
                &policy,
                &PathPolicy::default(),
                &WorkspacePath::root(workspace.id.clone()),
                PresetId::Zsh,
                TerminalSize {
                    columns: 80,
                    rows: 24
                }
            ),
            Err(TerminalError::TerminalDisabled)
        );
        workspace.trust_level = TrustLevel::Trusted;
        assert_eq!(
            resolve_initial_cwd(
                &PathPolicy::default(),
                &workspace,
                &WorkspacePath::new(workspace.id.clone(), "note.md").unwrap()
            ),
            Err(TerminalError::InvalidInitialCwd)
        );
    }
}
