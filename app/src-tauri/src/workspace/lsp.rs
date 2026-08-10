//! Bounded stdio transport for trusted, workspace-scoped language servers.
//!
//! The renderer-facing adapter is intentionally not in this module.  This is
//! the process/session seam that an IPC or loopback transport can wrap later.
//! Commands are backend-owned fixed definitions; no shell or renderer command
//! text enters the spawn path.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fmt;
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::registry::{WorkspaceId, WorkspaceKind, WorkspaceRecord};

/// Maximum number of running language servers for one workspace.
pub const MAX_LSP_SESSIONS_PER_WORKSPACE: usize = 4;
/// Maximum number of running language servers owned by one manager.
pub const MAX_LSP_SESSIONS_TOTAL: usize = 8;
/// LSP messages are deliberately bounded even though the protocol is a stream.
pub const MAX_LSP_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
/// Incoming messages are back-pressured rather than accumulated without limit.
pub const MAX_LSP_PENDING_MESSAGES: usize = 64;
/// A server that does not stop itself is eventually reaped by the watchdog.
pub const MAX_LSP_SESSION_LIFETIME: Duration = Duration::from_secs(30 * 60);
/// A receive call cannot hold a backend thread forever.
pub const MAX_LSP_RECEIVE_WAIT: Duration = Duration::from_secs(30);
const MAX_LSP_HEADER_BYTES: usize = 8 * 1024;
// ponytail: OS CPU/memory quotas need platform-specific job objects/rlimits;
// lifecycle, frame, queue, and session bounds are enforced portably here.

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LspServerKind {
    TypeScript,
    Python,
    Ruff,
    Rust,
}

impl LspServerKind {
    /// Fixed executable/argument definitions.  Keep this list closed: callers
    /// must select a variant instead of passing process text from the UI.
    #[must_use]
    pub const fn definition(self) -> LspServerDefinition {
        match self {
            Self::TypeScript => LspServerDefinition {
                kind: self,
                executable: "typescript-language-server",
                args: &["--stdio"],
                language_id: "typescript",
            },
            Self::Python => LspServerDefinition {
                kind: self,
                executable: "pyright-langserver",
                args: &["--stdio"],
                language_id: "python",
            },
            Self::Ruff => LspServerDefinition {
                kind: self,
                executable: "ruff",
                args: &["server"],
                language_id: "python",
            },
            Self::Rust => LspServerDefinition {
                kind: self,
                executable: "rust-analyzer",
                args: &[],
                language_id: "rust",
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct LspServerDefinition {
    pub kind: LspServerKind,
    pub executable: &'static str,
    pub args: &'static [&'static str],
    pub language_id: &'static str,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct LspSessionId(String);

impl LspSessionId {
    #[must_use]
    pub fn new() -> Self {
        Self(format!("lsp_{}", ulid::Ulid::new()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for LspSessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl From<&str> for LspSessionId {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LspSessionStatus {
    Running,
    Exited,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSessionSummary {
    pub id: LspSessionId,
    pub workspace_id: String,
    pub server: LspServerKind,
    pub root_uri: String,
    pub status: LspSessionStatus,
}

#[derive(Clone, Copy, Debug)]
pub struct LspLimits {
    pub max_sessions_per_workspace: usize,
    pub max_sessions_total: usize,
    pub max_message_bytes: usize,
    pub max_pending_messages: usize,
    pub max_session_lifetime: Duration,
    pub max_receive_wait: Duration,
}

impl Default for LspLimits {
    fn default() -> Self {
        Self {
            max_sessions_per_workspace: MAX_LSP_SESSIONS_PER_WORKSPACE,
            max_sessions_total: MAX_LSP_SESSIONS_TOTAL,
            max_message_bytes: MAX_LSP_MESSAGE_BYTES,
            max_pending_messages: MAX_LSP_PENDING_MESSAGES,
            max_session_lifetime: MAX_LSP_SESSION_LIFETIME,
            max_receive_wait: MAX_LSP_RECEIVE_WAIT,
        }
    }
}

impl LspLimits {
    fn valid(self) -> Result<Self, LspError> {
        if self.max_sessions_per_workspace == 0
            || self.max_sessions_total == 0
            || self.max_sessions_per_workspace > self.max_sessions_total
            || self.max_message_bytes == 0
            || self.max_pending_messages == 0
            || self.max_receive_wait.is_zero()
        {
            return Err(LspError::InvalidLimits);
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LspError {
    WorkspaceNotTrusted,
    VirtualWorkspace,
    WorkspaceUnavailable,
    WorkspaceLimit,
    TotalLimit,
    WorkspaceMismatch,
    SessionNotFound,
    SessionNotRunning,
    InvalidLimits,
    CommandUnavailable(LspServerKind),
    SpawnFailed,
    Io,
    TransportClosed,
    MessageQueueFull,
    FrameMissingContentLength,
    FrameInvalidContentLength,
    FrameTooLarge,
    FrameHeaderTooLarge,
    FrameInvalidHeader,
    InvalidJson,
    ReceiveTimeout,
    InvalidUri,
    UriOutsideWorkspace,
    PathNotFound,
    PathIo,
}

impl fmt::Display for LspError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WorkspaceNotTrusted => {
                formatter.write_str("language servers require a trusted workspace")
            }
            Self::VirtualWorkspace => {
                formatter.write_str("language servers require a filesystem workspace")
            }
            Self::WorkspaceUnavailable => formatter.write_str("workspace root is unavailable"),
            Self::WorkspaceLimit => formatter.write_str("workspace language-server limit reached"),
            Self::TotalLimit => formatter.write_str("language-server limit reached"),
            Self::WorkspaceMismatch => {
                formatter.write_str("language-server session belongs to another workspace")
            }
            Self::SessionNotFound => formatter.write_str("language-server session was not found"),
            Self::SessionNotRunning => {
                formatter.write_str("language-server session is not running")
            }
            Self::InvalidLimits => formatter.write_str("language-server limits are invalid"),
            Self::CommandUnavailable(_) => {
                formatter.write_str("language-server executable is unavailable")
            }
            Self::SpawnFailed => {
                formatter.write_str("language-server process could not be started")
            }
            Self::Io => formatter.write_str("language-server transport I/O failed"),
            Self::TransportClosed => formatter.write_str("language-server transport closed"),
            Self::MessageQueueFull => formatter.write_str("language-server message queue is full"),
            Self::FrameMissingContentLength => {
                formatter.write_str("language-server frame has no content length")
            }
            Self::FrameInvalidContentLength => {
                formatter.write_str("language-server frame content length is invalid")
            }
            Self::FrameTooLarge => {
                formatter.write_str("language-server frame exceeds the size limit")
            }
            Self::FrameHeaderTooLarge => {
                formatter.write_str("language-server frame header exceeds the size limit")
            }
            Self::FrameInvalidHeader => {
                formatter.write_str("language-server frame header is invalid")
            }
            Self::InvalidJson => formatter.write_str("language-server message is invalid JSON"),
            Self::ReceiveTimeout => {
                formatter.write_str("timed out waiting for language-server message")
            }
            Self::InvalidUri => formatter.write_str("language-server URI is invalid"),
            Self::UriOutsideWorkspace => {
                formatter.write_str("language-server URI resolves outside the workspace")
            }
            Self::PathNotFound => formatter.write_str("language-server path does not exist"),
            Self::PathIo => formatter.write_str("language-server path could not be checked"),
        }
    }
}

impl std::error::Error for LspError {}

/// Canonical workspace root ↔ `file://` URI mapping used by LSP initialize,
/// diagnostics, and locations.  Every reverse mapping is canonicalized and
/// checked again, so symlink escapes cannot be smuggled through a URI.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceUriMapper {
    canonical_root: PathBuf,
    workspace_id: Option<String>,
}

impl WorkspaceUriMapper {
    pub fn new(root: &Path) -> Result<Self, LspError> {
        Self::new_inner(None, root)
    }

    pub fn new_for_workspace(workspace_id: &WorkspaceId, root: &Path) -> Result<Self, LspError> {
        Self::new_inner(Some(workspace_id.to_string()), root)
    }

    fn new_inner(workspace_id: Option<String>, root: &Path) -> Result<Self, LspError> {
        if workspace_id.as_deref().is_some_and(|id| {
            id.is_empty()
                || !id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        }) {
            return Err(LspError::InvalidUri);
        }
        let canonical_root =
            std::fs::canonicalize(root).map_err(|_| LspError::WorkspaceUnavailable)?;
        if !canonical_root.is_dir() {
            return Err(LspError::WorkspaceUnavailable);
        }
        Ok(Self {
            canonical_root,
            workspace_id,
        })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.canonical_root
    }

    pub fn root_uri(&self) -> Result<String, LspError> {
        if let Some(workspace_id) = self.workspace_id.as_deref() {
            return Ok(format!("second-brain://{workspace_id}/"));
        }
        encode_file_uri(&self.canonical_root)
    }

    pub fn path_to_uri(&self, path: &Path) -> Result<String, LspError> {
        let canonical = self.resolve_path(path)?;
        if let Some(workspace_id) = self.workspace_id.as_deref() {
            let relative = canonical
                .strip_prefix(&self.canonical_root)
                .map_err(|_| LspError::UriOutsideWorkspace)?;
            return encode_virtual_uri(workspace_id, relative);
        }
        encode_file_uri(&canonical)
    }

    /// Convert a canonical workspace path to the file URI external servers
    /// expect, regardless of the renderer's virtual URI scheme.
    pub fn path_to_file_uri(&self, path: &Path) -> Result<String, LspError> {
        let canonical = self.resolve_path(path)?;
        encode_file_uri(&canonical)
    }

    pub fn uri_to_path(&self, uri: &str) -> Result<PathBuf, LspError> {
        if let Some(encoded) = uri.strip_prefix("second-brain://") {
            return self.virtual_uri_to_path(encoded);
        }
        let encoded = uri.strip_prefix("file://").ok_or(LspError::InvalidUri)?;
        let path = parse_file_uri_path(encoded)?;
        if !path.is_absolute()
            || path
                .components()
                .any(|component| component == Component::ParentDir)
        {
            return Err(LspError::InvalidUri);
        }
        self.resolve_path(&path)
    }

    fn virtual_uri_to_path(&self, encoded: &str) -> Result<PathBuf, LspError> {
        let (workspace_id, encoded_relative) =
            encoded.split_once('/').ok_or(LspError::InvalidUri)?;
        if self.workspace_id.as_deref() != Some(workspace_id) {
            return Err(LspError::UriOutsideWorkspace);
        }
        let decoded = percent_decode(encoded_relative.as_bytes())?;
        let decoded = String::from_utf8(decoded).map_err(|_| LspError::InvalidUri)?;
        let relative = PathBuf::from(decoded);
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| component == Component::ParentDir)
        {
            return Err(LspError::InvalidUri);
        }
        self.resolve_path(&self.canonical_root.join(relative))
    }

    fn resolve_path(&self, path: &Path) -> Result<PathBuf, LspError> {
        if !path.is_absolute() {
            return Err(LspError::InvalidUri);
        }
        if path
            .components()
            .any(|component| component == Component::ParentDir)
        {
            return Err(LspError::UriOutsideWorkspace);
        }
        match std::fs::canonicalize(path) {
            Ok(canonical) => {
                if is_within(&self.canonical_root, &canonical) {
                    Ok(canonical)
                } else {
                    Err(LspError::UriOutsideWorkspace)
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let mut nearest = path.to_path_buf();
                let mut missing = Vec::new();
                loop {
                    match std::fs::symlink_metadata(&nearest) {
                        Ok(_) => break,
                        Err(error) if error.kind() == io::ErrorKind::NotFound => {
                            let name = nearest.file_name().ok_or(LspError::PathNotFound)?;
                            missing.push(name.to_owned());
                            nearest.pop();
                        }
                        Err(_) => return Err(LspError::PathIo),
                    }
                }
                let canonical_nearest =
                    std::fs::canonicalize(nearest).map_err(|_| LspError::PathIo)?;
                if !is_within(&self.canonical_root, &canonical_nearest) {
                    return Err(LspError::UriOutsideWorkspace);
                }
                let mut resolved = canonical_nearest;
                for name in missing.iter().rev() {
                    resolved.push(name);
                }
                Ok(resolved)
            }
            Err(_) => Err(LspError::PathIo),
        }
    }
}

/// Encode a JSON-RPC/LSP payload using the framing expected by Monaco's LSP
/// clients and the standard language-server stdio transport.
pub fn encode_lsp_frame(value: &Value, max_bytes: usize) -> Result<Vec<u8>, LspError> {
    let body = serde_json::to_vec(value).map_err(|_| LspError::InvalidJson)?;
    if body.len() > max_bytes {
        return Err(LspError::FrameTooLarge);
    }
    let mut frame = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    frame.extend_from_slice(&body);
    Ok(frame)
}

/// Read one standard LSP frame.  It is public for deterministic transport
/// tests and for adapters that need to bridge stdio to a websocket.
pub fn decode_lsp_frame<R: BufRead>(reader: &mut R, max_bytes: usize) -> Result<Vec<u8>, LspError> {
    let mut header_bytes = 0_usize;
    let mut content_length = None;
    let mut line = Vec::new();
    loop {
        line.clear();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(|_| LspError::Io)?;
        if read == 0 {
            return Err(LspError::TransportClosed);
        }
        header_bytes = header_bytes.saturating_add(read);
        if header_bytes > MAX_LSP_HEADER_BYTES {
            return Err(LspError::FrameHeaderTooLarge);
        }
        let trimmed = line.strip_suffix(b"\n").unwrap_or(&line);
        let trimmed = trimmed.strip_suffix(b"\r").unwrap_or(trimmed);
        if trimmed.is_empty() {
            break;
        }
        let header = std::str::from_utf8(trimmed).map_err(|_| LspError::FrameInvalidHeader)?;
        let (name, value) = header.split_once(':').ok_or(LspError::FrameInvalidHeader)?;
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(LspError::FrameInvalidContentLength);
            }
            let parsed = value
                .trim()
                .parse::<usize>()
                .map_err(|_| LspError::FrameInvalidContentLength)?;
            content_length = Some(parsed);
        }
    }
    let length = content_length.ok_or(LspError::FrameMissingContentLength)?;
    if length > max_bytes {
        return Err(LspError::FrameTooLarge);
    }
    let mut body = vec![0_u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|_| LspError::TransportClosed)?;
    Ok(body)
}

fn rewrite_for_server(value: &Value, mapper: &WorkspaceUriMapper) -> Result<Value, LspError> {
    let mut rewritten = rewrite_uri_fields(value, mapper, true)?;
    if rewritten.get("method").and_then(Value::as_str) == Some("initialize") {
        if let Some(params) = rewritten.get_mut("params").and_then(Value::as_object_mut) {
            if params.get("rootUri").is_none_or(Value::is_null) {
                params.insert(
                    "rootUri".to_owned(),
                    Value::String(mapper.path_to_file_uri(mapper.root())?),
                );
            }
        }
    }
    Ok(rewritten)
}

fn rewrite_for_client(value: &Value, mapper: &WorkspaceUriMapper) -> Result<Value, LspError> {
    rewrite_uri_fields(value, mapper, false)
}

fn rewrite_uri_fields(
    value: &Value,
    mapper: &WorkspaceUriMapper,
    to_server: bool,
) -> Result<Value, LspError> {
    match value {
        Value::Object(object) => object
            .iter()
            .map(|(key, value)| {
                let value = if is_uri_key(key) {
                    match value {
                        Value::String(uri) => Value::String(rewrite_uri(uri, mapper, to_server)?),
                        other => rewrite_uri_fields(other, mapper, to_server)?,
                    }
                } else {
                    rewrite_uri_fields(value, mapper, to_server)?
                };
                Ok((key.clone(), value))
            })
            .collect::<Result<serde_json::Map<_, _>, LspError>>()
            .map(Value::Object),
        Value::Array(values) => values
            .iter()
            .map(|value| rewrite_uri_fields(value, mapper, to_server))
            .collect::<Result<Vec<_>, LspError>>()
            .map(Value::Array),
        other => Ok(other.clone()),
    }
}

fn is_uri_key(key: &str) -> bool {
    key.eq_ignore_ascii_case("uri") || key.to_ascii_lowercase().ends_with("uri")
}

fn rewrite_uri(
    uri: &str,
    mapper: &WorkspaceUriMapper,
    to_server: bool,
) -> Result<String, LspError> {
    if to_server {
        if uri.starts_with("second-brain://") || uri.starts_with("file://") {
            let path = mapper.uri_to_path(uri)?;
            mapper.path_to_file_uri(&path)
        } else {
            Ok(uri.to_owned())
        }
    } else if uri.starts_with("file://") {
        let path = mapper.uri_to_path(uri)?;
        mapper.path_to_uri(&path)
    } else if uri.starts_with("second-brain://") {
        // Validate virtual URIs from an external server even when they are
        // already in the renderer scheme.
        let path = mapper.uri_to_path(uri)?;
        mapper.path_to_uri(&path)
    } else {
        Ok(uri.to_owned())
    }
}

type IncomingMessages = mpsc::Receiver<Result<Vec<u8>, LspError>>;

struct LspSessionInner {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    incoming: Arc<Mutex<IncomingMessages>>,
    status: Arc<AtomicU8>,
    max_message_bytes: usize,
    max_receive_wait: Duration,
    mapper: WorkspaceUriMapper,
}

impl LspSessionInner {
    fn status(&self) -> LspSessionStatus {
        let state = self.status.load(Ordering::Acquire);
        if state == PROCESS_RUNNING {
            match self.child.lock() {
                Ok(mut child) => match child.try_wait() {
                    Ok(Some(_)) => {
                        self.status.store(PROCESS_EXITED, Ordering::Release);
                        LspSessionStatus::Exited
                    }
                    Ok(None) => LspSessionStatus::Running,
                    Err(_) => {
                        self.status.store(PROCESS_FAILED, Ordering::Release);
                        LspSessionStatus::Failed
                    }
                },
                Err(_) => LspSessionStatus::Failed,
            }
        } else {
            status_from_byte(state)
        }
    }

    fn send(&self, value: &Value) -> Result<(), LspError> {
        if self.status() != LspSessionStatus::Running {
            return Err(LspError::SessionNotRunning);
        }
        let value = rewrite_for_server(value, &self.mapper)?;
        let frame = encode_lsp_frame(&value, self.max_message_bytes)?;
        let mut stdin = self.stdin.lock().map_err(|_| LspError::Io)?;
        stdin.write_all(&frame).map_err(|_| {
            self.status.store(PROCESS_FAILED, Ordering::Release);
            kill_child(&self.child);
            LspError::Io
        })?;
        stdin.flush().map_err(|_| {
            self.status.store(PROCESS_FAILED, Ordering::Release);
            kill_child(&self.child);
            LspError::Io
        })
    }

    fn receive(&self, timeout: Duration) -> Result<Value, LspError> {
        if self.status() != LspSessionStatus::Running {
            return Err(LspError::SessionNotRunning);
        }
        let timeout = timeout.min(self.max_receive_wait);
        let incoming = self.incoming.lock().map_err(|_| LspError::Io)?;
        let body = incoming
            .recv_timeout(timeout)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => LspError::ReceiveTimeout,
                mpsc::RecvTimeoutError::Disconnected => LspError::TransportClosed,
            })??;
        let value = serde_json::from_slice::<Value>(&body).map_err(|_| {
            self.status.store(PROCESS_FAILED, Ordering::Release);
            kill_child(&self.child);
            LspError::InvalidJson
        })?;
        rewrite_for_client(&value, &self.mapper)
    }

    fn stop(&self) {
        self.status.store(PROCESS_STOPPED, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for LspSessionInner {
    fn drop(&mut self) {
        self.stop();
    }
}

const PROCESS_RUNNING: u8 = 0;
const PROCESS_EXITED: u8 = 1;
const PROCESS_STOPPED: u8 = 2;
const PROCESS_FAILED: u8 = 3;

fn status_from_byte(value: u8) -> LspSessionStatus {
    match value {
        PROCESS_EXITED => LspSessionStatus::Exited,
        PROCESS_STOPPED => LspSessionStatus::Stopped,
        PROCESS_FAILED => LspSessionStatus::Failed,
        _ => LspSessionStatus::Running,
    }
}

fn start_reader(
    stdout: ChildStdout,
    sender: mpsc::SyncSender<Result<Vec<u8>, LspError>>,
    child: Arc<Mutex<Child>>,
    status: Arc<AtomicU8>,
    max_message_bytes: usize,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let result = decode_lsp_frame(&mut reader, max_message_bytes);
            match result {
                Ok(body) => match sender.try_send(Ok(body)) {
                    Ok(()) => {}
                    Err(mpsc::TrySendError::Full(_)) => {
                        status.store(PROCESS_FAILED, Ordering::Release);
                        let _ = sender.try_send(Err(LspError::MessageQueueFull));
                        kill_child(&child);
                        break;
                    }
                    Err(mpsc::TrySendError::Disconnected(_)) => {
                        kill_child(&child);
                        break;
                    }
                },
                Err(error) => {
                    let closed = matches!(error, LspError::TransportClosed);
                    status.store(
                        if closed {
                            PROCESS_EXITED
                        } else {
                            PROCESS_FAILED
                        },
                        Ordering::Release,
                    );
                    let _ = sender.try_send(Err(error));
                    // A closed stdout is not enough proof that the process is
                    // gone (a child can close one descriptor and keep running).
                    // Reap it in either case so the session cannot leak.
                    kill_child(&child);
                    break;
                }
            }
        }
    });
}

fn start_watchdog(child: Arc<Mutex<Child>>, status: Arc<AtomicU8>, lifetime: Duration) {
    thread::spawn(move || {
        let started = Instant::now();
        loop {
            if status.load(Ordering::Acquire) != PROCESS_RUNNING {
                break;
            }
            if let Ok(mut process) = child.lock() {
                match process.try_wait() {
                    Ok(Some(_)) => {
                        status.store(PROCESS_EXITED, Ordering::Release);
                        break;
                    }
                    Ok(None) => {}
                    Err(_) => {
                        status.store(PROCESS_FAILED, Ordering::Release);
                        drop(process);
                        kill_child(&child);
                        break;
                    }
                }
            }
            if started.elapsed() >= lifetime {
                status.store(PROCESS_FAILED, Ordering::Release);
                kill_child(&child);
                break;
            }
            thread::sleep(
                Duration::from_millis(250).min(lifetime.saturating_sub(started.elapsed())),
            );
        }
    });
}

fn kill_child(child: &Arc<Mutex<Child>>) {
    if let Ok(mut child) = child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

struct LspSessionState {
    summary: LspSessionSummary,
    inner: Arc<LspSessionInner>,
}

/// Process/session manager used by the application adapter.  It deliberately
/// exposes only fixed server kinds and workspace-scoped handles.
pub struct LspManager {
    sessions: HashMap<LspSessionId, LspSessionState>,
    limits: LspLimits,
}

impl LspManager {
    #[must_use]
    pub fn new() -> Self {
        Self::with_limits(LspLimits::default()).expect("default LSP limits are valid")
    }

    pub fn with_limits(limits: LspLimits) -> Result<Self, LspError> {
        Ok(Self {
            sessions: HashMap::new(),
            limits: limits.valid()?,
        })
    }

    pub fn start(
        &mut self,
        workspace: &WorkspaceRecord,
        server: LspServerKind,
    ) -> Result<LspSessionSummary, LspError> {
        if workspace.deleted {
            return Err(LspError::WorkspaceUnavailable);
        }
        if !workspace.trust_level.capabilities().terminal {
            return Err(LspError::WorkspaceNotTrusted);
        }
        if workspace.kind == WorkspaceKind::Collection {
            return Err(LspError::VirtualWorkspace);
        }
        let root = workspace.root_path().ok_or_else(|| {
            if workspace.canonical_root.is_none() {
                LspError::VirtualWorkspace
            } else {
                LspError::WorkspaceUnavailable
            }
        })?;
        let mapper = WorkspaceUriMapper::new_for_workspace(&workspace.id, root)?;
        self.start_at_root(&workspace.id, mapper, server)
    }

    /// Start against an already-authorized canonical root.  This is useful for
    /// adapters that have looked up a workspace record before acquiring their
    /// manager lock; it still canonicalizes and checks the root here.
    pub(crate) fn start_at_root(
        &mut self,
        workspace_id: &WorkspaceId,
        mapper: WorkspaceUriMapper,
        server: LspServerKind,
    ) -> Result<LspSessionSummary, LspError> {
        if mapper
            .workspace_id
            .as_deref()
            .is_some_and(|id| id != workspace_id.as_str())
        {
            return Err(LspError::WorkspaceMismatch);
        }
        self.prune_finished();
        let workspace_count = self
            .sessions
            .values()
            .filter(|state| state.summary.workspace_id == workspace_id.as_str())
            .count();
        if workspace_count >= self.limits.max_sessions_per_workspace {
            return Err(LspError::WorkspaceLimit);
        }
        if self.sessions.len() >= self.limits.max_sessions_total {
            return Err(LspError::TotalLimit);
        }

        let root_uri = mapper.root_uri()?;
        let definition = server.definition();
        let mut command = Command::new(definition.executable);
        command
            .args(definition.args)
            .current_dir(mapper.root())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Server diagnostics may include source text; discard stderr by
            // default rather than accidentally logging it.
            .stderr(Stdio::null());
        // Keep only command lookup configuration.  Credentials and arbitrary
        // renderer-provided environment values never cross this boundary.
        command.env_clear();
        command.env("PATH", lsp_search_path(mapper.root()));
        let mut child = command.spawn().map_err(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                LspError::CommandUnavailable(server)
            } else {
                LspError::SpawnFailed
            }
        })?;
        if let Ok(Some(_)) = child.try_wait() {
            return Err(LspError::CommandUnavailable(server));
        }
        let stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(LspError::SpawnFailed);
            }
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(LspError::SpawnFailed);
            }
        };
        let child = Arc::new(Mutex::new(child));
        let stdin = Arc::new(Mutex::new(stdin));
        let status = Arc::new(AtomicU8::new(PROCESS_RUNNING));
        let (sender, receiver) = mpsc::sync_channel(self.limits.max_pending_messages);
        start_reader(
            stdout,
            sender,
            child.clone(),
            status.clone(),
            self.limits.max_message_bytes,
        );
        start_watchdog(
            child.clone(),
            status.clone(),
            self.limits.max_session_lifetime,
        );

        let inner = Arc::new(LspSessionInner {
            child,
            stdin,
            incoming: Arc::new(Mutex::new(receiver)),
            status,
            max_message_bytes: self.limits.max_message_bytes,
            max_receive_wait: self.limits.max_receive_wait,
            mapper,
        });
        let id = LspSessionId::new();
        let summary = LspSessionSummary {
            id: id.clone(),
            workspace_id: workspace_id.to_string(),
            server,
            root_uri,
            status: LspSessionStatus::Running,
        };
        self.sessions.insert(
            id,
            LspSessionState {
                summary: summary.clone(),
                inner,
            },
        );
        Ok(summary)
    }

    pub fn send(
        &self,
        workspace_id: &WorkspaceId,
        session_id: &LspSessionId,
        message: &Value,
    ) -> Result<(), LspError> {
        let state = self.scoped(workspace_id, session_id)?;
        state.inner.send(message)
    }

    pub fn receive(
        &self,
        workspace_id: &WorkspaceId,
        session_id: &LspSessionId,
        timeout: Duration,
    ) -> Result<Value, LspError> {
        let state = self.scoped(workspace_id, session_id)?;
        state.inner.receive(timeout)
    }

    pub fn stop(
        &mut self,
        workspace_id: &WorkspaceId,
        session_id: &LspSessionId,
    ) -> Result<LspSessionSummary, LspError> {
        let state = self
            .sessions
            .remove(session_id)
            .ok_or(LspError::SessionNotFound)?;
        if state.summary.workspace_id != workspace_id.as_str() {
            self.sessions.insert(session_id.clone(), state);
            return Err(LspError::WorkspaceMismatch);
        }
        state.inner.stop();
        let mut summary = state.summary;
        summary.status = LspSessionStatus::Stopped;
        Ok(summary)
    }

    pub fn stop_workspace(&mut self, workspace_id: &WorkspaceId) -> usize {
        let ids = self
            .sessions
            .iter()
            .filter(|(_, state)| state.summary.workspace_id == workspace_id.as_str())
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        let count = ids.len();
        for id in ids {
            if let Some(state) = self.sessions.remove(&id) {
                state.inner.stop();
            }
        }
        count
    }

    pub fn session(
        &self,
        workspace_id: &WorkspaceId,
        session_id: &LspSessionId,
    ) -> Result<LspSessionSummary, LspError> {
        let state = self.scoped(workspace_id, session_id)?;
        let mut summary = state.summary.clone();
        summary.status = state.inner.status();
        Ok(summary)
    }

    #[must_use]
    pub fn sessions(&self, workspace_id: &WorkspaceId) -> Vec<LspSessionSummary> {
        let mut sessions = self
            .sessions
            .values()
            .filter(|state| state.summary.workspace_id == workspace_id.as_str())
            .map(|state| {
                let mut summary = state.summary.clone();
                summary.status = state.inner.status();
                summary
            })
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.id.cmp(&right.id));
        sessions
    }

    fn scoped(
        &self,
        workspace_id: &WorkspaceId,
        session_id: &LspSessionId,
    ) -> Result<&LspSessionState, LspError> {
        let state = self
            .sessions
            .get(session_id)
            .ok_or(LspError::SessionNotFound)?;
        if state.summary.workspace_id != workspace_id.as_str() {
            return Err(LspError::WorkspaceMismatch);
        }
        Ok(state)
    }

    fn prune_finished(&mut self) {
        let finished = self
            .sessions
            .iter()
            .filter(|(_, state)| state.inner.status() != LspSessionStatus::Running)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in finished {
            if let Some(state) = self.sessions.remove(&id) {
                state.inner.stop();
            }
        }
    }
}

impl Default for LspManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for LspManager {
    fn drop(&mut self) {
        for state in self.sessions.drain().map(|(_, state)| state) {
            state.inner.stop();
        }
    }
}

fn is_within(root: &Path, path: &Path) -> bool {
    path == root || path.strip_prefix(root).is_ok()
}

fn lsp_search_path(root: &Path) -> OsString {
    let mut paths = vec![
        root.join("node_modules").join(".bin"),
        root.join(".venv").join("bin"),
        root.join("venv").join("bin"),
    ];
    if cfg!(windows) {
        paths.extend([root.join(".venv/Scripts"), root.join("venv/Scripts")]);
    }
    paths.extend(
        std::env::var_os("PATH")
            .as_deref()
            .into_iter()
            .flat_map(std::env::split_paths),
    );
    std::env::join_paths(paths).unwrap_or_default()
}

fn encode_file_uri(path: &Path) -> Result<String, LspError> {
    let text = path.to_str().ok_or(LspError::InvalidUri)?;
    let mut uri = String::from("file://");
    if !text.starts_with('/') {
        uri.push('/');
    }
    for byte in text.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/' | b':') {
            uri.push(*byte as char);
        } else {
            uri.push('%');
            uri.push(hex((*byte >> 4) & 0x0f));
            uri.push(hex(*byte & 0x0f));
        }
    }
    Ok(uri)
}

fn encode_virtual_uri(workspace_id: &str, relative: &Path) -> Result<String, LspError> {
    let relative = relative.to_str().ok_or(LspError::InvalidUri)?;
    if relative.is_empty() {
        return Ok(format!("second-brain://{workspace_id}/"));
    }
    let mut uri = format!("second-brain://{workspace_id}/");
    for byte in relative.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~' | b'/') {
            uri.push(*byte as char);
        } else {
            uri.push('%');
            uri.push(hex((*byte >> 4) & 0x0f));
            uri.push(hex(*byte & 0x0f));
        }
    }
    Ok(uri)
}

fn parse_file_uri_path(encoded: &str) -> Result<PathBuf, LspError> {
    let (authority, encoded_path) = encoded.split_once('/').ok_or(LspError::InvalidUri)?;
    if !authority.is_empty() && !authority.eq_ignore_ascii_case("localhost") {
        return Err(LspError::InvalidUri);
    }
    if encoded_path.contains('?') || encoded_path.contains('#') {
        return Err(LspError::InvalidUri);
    }
    let decoded = percent_decode(encoded_path.as_bytes())?;
    let decoded = String::from_utf8(decoded).map_err(|_| LspError::InvalidUri)?;
    Ok(PathBuf::from(format!("/{decoded}")))
}

fn percent_decode(input: &[u8]) -> Result<Vec<u8>, LspError> {
    let mut output = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            if index + 2 >= input.len() {
                return Err(LspError::InvalidUri);
            }
            let high = from_hex(input[index + 1]).ok_or(LspError::InvalidUri)?;
            let low = from_hex(input[index + 2]).ok_or(LspError::InvalidUri)?;
            let byte = (high << 4) | low;
            if byte == 0 {
                return Err(LspError::InvalidUri);
            }
            output.push(byte);
            index += 3;
        } else {
            if input[index] == 0 {
                return Err(LspError::InvalidUri);
            }
            output.push(input[index]);
            index += 1;
        }
    }
    Ok(output)
}

fn from_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn hex(byte: u8) -> char {
    match byte {
        0..=9 => (b'0' + byte) as char,
        _ => (b'A' + byte - 10) as char,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn server_definitions_are_closed_and_shell_free() {
        assert_eq!(
            LspServerKind::TypeScript.definition(),
            LspServerDefinition {
                kind: LspServerKind::TypeScript,
                executable: "typescript-language-server",
                args: &["--stdio"],
                language_id: "typescript",
            }
        );
        assert_eq!(
            LspServerKind::Python.definition().executable,
            "pyright-langserver"
        );
        assert_eq!(LspServerKind::Ruff.definition().args, &["server"]);
        assert_eq!(LspServerKind::Rust.definition().executable, "rust-analyzer");
        for kind in [
            LspServerKind::TypeScript,
            LspServerKind::Python,
            LspServerKind::Ruff,
            LspServerKind::Rust,
        ] {
            assert!(!kind.definition().args.iter().any(|arg| arg.contains("sh")));
        }
    }

    #[test]
    fn search_path_prefers_workspace_language_servers() {
        let root = PathBuf::from("/workspace");
        let paths = std::env::split_paths(&lsp_search_path(&root)).collect::<Vec<_>>();
        assert_eq!(paths.first(), Some(&root.join("node_modules/.bin")));
        assert!(paths.contains(&root.join(".venv/bin")));
    }

    #[test]
    fn lsp_frames_round_trip_and_reject_unbounded_payloads() {
        let value = serde_json::json!({"jsonrpc": "2.0", "method": "initialize"});
        let frame = encode_lsp_frame(&value, 1024).expect("frame");
        let mut reader = io::Cursor::new(frame);
        let body = decode_lsp_frame(&mut reader, 1024).expect("body");
        assert_eq!(serde_json::from_slice::<Value>(&body).expect("json"), value);

        let oversized = serde_json::json!({"source": "x".repeat(16)});
        assert_eq!(
            encode_lsp_frame(&oversized, 8),
            Err(LspError::FrameTooLarge)
        );
        let mut malformed = io::Cursor::new(b"Content-Length: nope\r\n\r\n".to_vec());
        assert_eq!(
            decode_lsp_frame(&mut malformed, 1024),
            Err(LspError::FrameInvalidContentLength)
        );
    }

    #[test]
    fn workspace_uri_mapping_round_trips_and_rejects_escapes() {
        let directory = tempdir().expect("tempdir");
        let root = directory.path().join("workspace");
        fs::create_dir(&root).expect("root");
        let note = root.join("a file.ts");
        fs::write(&note, "const answer = 42;").expect("note");
        let mapper = WorkspaceUriMapper::new(&root).expect("mapper");
        let uri = mapper.path_to_uri(&note).expect("uri");
        assert!(uri.contains("a%20file.ts"));
        assert_eq!(
            mapper.uri_to_path(&uri).expect("path"),
            fs::canonicalize(&note).expect("canonical")
        );
        assert_eq!(
            mapper.uri_to_path("file:///etc/passwd"),
            Err(LspError::UriOutsideWorkspace)
        );
        assert_eq!(
            mapper.uri_to_path("file:///tmp/workspace/../secret"),
            Err(LspError::InvalidUri)
        );
        assert_eq!(
            mapper.uri_to_path("file://remote/workspace/a.ts"),
            Err(LspError::InvalidUri)
        );

        let workspace_id = WorkspaceId::from("ws_demo");
        let virtual_mapper =
            WorkspaceUriMapper::new_for_workspace(&workspace_id, &root).expect("virtual mapper");
        let virtual_uri = virtual_mapper.path_to_uri(&note).expect("virtual uri");
        assert_eq!(virtual_uri, "second-brain://ws_demo/a%20file.ts");
        assert_eq!(
            virtual_mapper
                .uri_to_path(&virtual_uri)
                .expect("virtual path"),
            fs::canonicalize(&note).expect("canonical")
        );
        assert_eq!(
            virtual_mapper.uri_to_path("second-brain://other/a.ts"),
            Err(LspError::UriOutsideWorkspace)
        );
        assert_eq!(
            virtual_mapper.uri_to_path("second-brain://ws_demo/../secret"),
            Err(LspError::InvalidUri)
        );
        let missing = root.join("new.ts");
        let missing_uri = virtual_mapper.path_to_uri(&missing).expect("missing uri");
        assert_eq!(missing_uri, "second-brain://ws_demo/new.ts");
        assert_eq!(
            virtual_mapper
                .uri_to_path(&missing_uri)
                .expect("missing path"),
            fs::canonicalize(&root)
                .expect("canonical root")
                .join("new.ts")
        );
    }

    #[test]
    fn uri_fields_bridge_virtual_renderer_and_file_server_safely() {
        let directory = tempdir().expect("tempdir");
        let root = directory.path().join("workspace");
        fs::create_dir(&root).expect("root");
        let note = root.join("src/main.ts");
        fs::create_dir(root.join("src")).expect("src");
        fs::write(&note, "export const answer = 42;").expect("note");
        let workspace_id = WorkspaceId::from("ws_bridge");
        let mapper = WorkspaceUriMapper::new_for_workspace(&workspace_id, &root).expect("mapper");
        let virtual_uri = mapper.path_to_uri(&note).expect("virtual uri");
        let server = rewrite_for_server(
            &serde_json::json!({
                "method": "textDocument/didOpen",
                "params": {
                    "textDocument": {"uri": virtual_uri, "text": "second-brain://ws_bridge/keep-as-text"}
                }
            }),
            &mapper,
        )
        .expect("server message");
        assert_eq!(
            server["params"]["textDocument"]["uri"],
            mapper.path_to_file_uri(&note).expect("file uri")
        );
        assert_eq!(
            server["params"]["textDocument"]["text"],
            "second-brain://ws_bridge/keep-as-text"
        );

        let client = rewrite_for_client(&server, &mapper).expect("client message");
        assert_eq!(client["params"]["textDocument"]["uri"], virtual_uri);
        let initialize = rewrite_for_server(
            &serde_json::json!({"method": "initialize", "params": {"rootUri": null}}),
            &mapper,
        )
        .expect("initialize message");
        assert_eq!(
            initialize["params"]["rootUri"],
            mapper.path_to_file_uri(&root).expect("root uri")
        );
        assert_eq!(
            rewrite_for_server(
                &serde_json::json!({"params": {"textDocument": {"uri": "file:///etc/passwd"}}}),
                &mapper
            ),
            Err(LspError::UriOutsideWorkspace)
        );
    }

    #[test]
    fn manager_rejects_untrusted_and_virtual_workspaces_without_spawning() {
        let mut manager = LspManager::new();
        let untrusted = WorkspaceRecord {
            id: WorkspaceId::from("ws_untrusted"),
            name: "untrusted".into(),
            kind: super::super::registry::WorkspaceKind::Project,
            display_root: None,
            canonical_root: None,
            manifest_path: None,
            trust_level: super::super::trust::TrustLevel::Untrusted,
            index_enabled: true,
            deleted: false,
        };
        assert_eq!(
            manager.start(&untrusted, LspServerKind::Rust),
            Err(LspError::WorkspaceNotTrusted)
        );
        let virtual_workspace = WorkspaceRecord {
            trust_level: super::super::trust::TrustLevel::Trusted,
            id: WorkspaceId::from("ws_virtual"),
            kind: super::super::registry::WorkspaceKind::Collection,
            ..untrusted
        };
        assert_eq!(
            manager.start(&virtual_workspace, LspServerKind::Rust),
            Err(LspError::VirtualWorkspace)
        );
    }

    #[test]
    fn limits_reject_zero_and_inconsistent_values() {
        assert!(matches!(
            LspManager::with_limits(LspLimits {
                max_sessions_per_workspace: 0,
                ..LspLimits::default()
            }),
            Err(LspError::InvalidLimits)
        ));
        assert!(matches!(
            LspManager::with_limits(LspLimits {
                max_sessions_per_workspace: 3,
                max_sessions_total: 2,
                ..LspLimits::default()
            }),
            Err(LspError::InvalidLimits)
        ));
    }
}
