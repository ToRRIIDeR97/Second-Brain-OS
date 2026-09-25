//! Native PTY adapter backed by `portable-pty`.
//!
//! The manager owns workspace and trust validation. This adapter only accepts
//! the fixed backend presets represented by [`SpawnRequest`], keeps handles
//! private, and exposes bounded reader events for the application layer.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc::{Receiver, SyncSender, TryRecvError, channel, sync_channel};
use std::thread;

use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

use super::{PtyAdapter, SpawnRequest, TerminalId, TerminalSize};

const EVENT_QUEUE_CAPACITY: usize = 64;
const OUTPUT_CHUNK_SIZE: usize = 8 * 1024;

/// Events emitted by a native PTY reader or child waiter.
#[derive(Debug, Eq, PartialEq)]
pub enum NativePtyEvent {
    Output {
        terminal_id: TerminalId,
        bytes: Vec<u8>,
    },
    Exited {
        terminal_id: TerminalId,
        exit_code: Option<i32>,
    },
}

struct NativeSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// A process-backed PTY adapter for supported desktop platforms.
///
/// Reader events are queued in a bounded channel. A producer blocks when the
/// queue is full, allowing kernel PTY backpressure to stop unbounded memory
/// growth instead of buffering terminal output indefinitely.
pub struct NativePtyAdapter {
    pty_system: Box<dyn portable_pty::PtySystem + Send>,
    sessions: HashMap<TerminalId, NativeSession>,
    events: Receiver<NativePtyEvent>,
    event_sender: SyncSender<NativePtyEvent>,
}

impl NativePtyAdapter {
    #[must_use]
    pub fn new() -> Self {
        let (event_sender, events) = sync_channel(EVENT_QUEUE_CAPACITY);
        Self {
            pty_system: native_pty_system(),
            sessions: HashMap::new(),
            events,
            event_sender,
        }
    }

    /// Drain at most `limit` events without waiting for another PTY read.
    pub fn drain_events(&mut self, limit: usize) -> Vec<NativePtyEvent> {
        let mut events = Vec::new();
        while events.len() < limit {
            match self.events.try_recv() {
                Ok(event) => {
                    if let NativePtyEvent::Exited { terminal_id, .. } = &event {
                        self.sessions.remove(terminal_id);
                    }
                    events.push(event);
                }
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
            }
        }
        events
    }

    #[must_use]
    pub fn contains(&self, terminal_id: &TerminalId) -> bool {
        self.sessions.contains_key(terminal_id)
    }

    fn spawn_reader(
        &self,
        terminal_id: TerminalId,
        mut reader: Box<dyn Read + Send>,
    ) -> Receiver<()> {
        let sender = self.event_sender.clone();
        let (done_sender, done_receiver) = channel();
        thread::spawn(move || {
            let mut buffer = [0_u8; OUTPUT_CHUNK_SIZE];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(length) => {
                        if sender
                            .send(NativePtyEvent::Output {
                                terminal_id: terminal_id.clone(),
                                bytes: buffer[..length].to_vec(),
                            })
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = done_sender.send(());
        });
        done_receiver
    }

    fn spawn_waiter(
        &self,
        terminal_id: TerminalId,
        mut child: Box<dyn Child + Send + Sync>,
        reader_done: Receiver<()>,
    ) {
        let sender = self.event_sender.clone();
        thread::spawn(move || {
            let exit_code = child
                .wait()
                .ok()
                .map(|status| i32::try_from(status.exit_code()).unwrap_or(i32::MAX));
            // Drain all bytes read before reporting exit. This prevents the
            // manager from marking a session exited before its final output.
            let _ = reader_done.recv();
            let _ = sender.send(NativePtyEvent::Exited {
                terminal_id,
                exit_code,
            });
        });
    }

    fn allowed_preset(request: &SpawnRequest) -> bool {
        match request.executable {
            "zsh" | "bash" => request.args == ["-l"],
            "fish" => request.args == ["-l"],
            "pwsh" => request.args == ["-NoLogo"],
            "powershell.exe" => matches!(
                request.args,
                ["-NoLogo"]
                    | ["-NoLogo", "-NoExit", "-Command", "codex"]
                    | ["-NoLogo", "-NoExit", "-Command", "claude"]
            ),
            "codex" | "claude" => request.args.is_empty(),
            _ => false,
        }
    }

    fn configure_environment(command: &mut CommandBuilder) {
        // The child receives only display and shell runtime metadata. In
        // particular, API keys, tokens, and arbitrary parent-process values
        // are not copied into a terminal session.
        command.env_clear();
        for key in [
            "PATH",
            "HOME",
            "USER",
            "LOGNAME",
            "TERM",
            "COLORTERM",
            "LANG",
            "LC_ALL",
            "LC_CTYPE",
            "TMPDIR",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        #[cfg(target_os = "windows")]
        for key in [
            "APPDATA",
            "COMSPEC",
            "HOMEDRIVE",
            "HOMEPATH",
            "LOCALAPPDATA",
            "PATHEXT",
            "SystemDrive",
            "SystemRoot",
            "TEMP",
            "TMP",
            "USERPROFILE",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        if command.get_env("TERM").is_none() {
            command.env("TERM", "xterm-256color");
        }
    }
}

impl Default for NativePtyAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyAdapter for NativePtyAdapter {
    fn spawn(&mut self, request: &SpawnRequest) -> Result<(), String> {
        if !Self::allowed_preset(request) {
            return Err("terminal preset is not approved by the backend".to_owned());
        }
        if request.size.columns == 0 || request.size.rows == 0 {
            return Err("terminal dimensions must be non-zero".to_owned());
        }
        if !request.cwd.is_absolute() || !request.cwd.is_dir() {
            return Err("terminal cwd must be an existing absolute directory".to_owned());
        }
        if self.sessions.contains_key(&request.terminal_id) {
            return Err("terminal session already exists".to_owned());
        }

        let pair = self
            .pty_system
            .openpty(PtySize {
                rows: request.size.rows,
                cols: request.size.columns,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())?;
        let mut command = CommandBuilder::new(request.executable);
        command.args(request.args);
        command.cwd(&request.cwd);
        Self::configure_environment(&mut command);

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| error.to_string())?;
        drop(pair.slave);

        let killer = child.clone_killer();
        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                let mut killer = killer;
                let _ = killer.kill();
                let mut child = child;
                let _ = child.wait();
                return Err(error.to_string());
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                let mut killer = killer;
                let _ = killer.kill();
                let mut child = child;
                let _ = child.wait();
                return Err(error.to_string());
            }
        };

        let reader_done = self.spawn_reader(request.terminal_id.clone(), reader);
        self.spawn_waiter(request.terminal_id.clone(), child, reader_done);
        self.sessions.insert(
            request.terminal_id.clone(),
            NativeSession {
                master: pair.master,
                writer,
                killer,
            },
        );
        Ok(())
    }

    fn write(&mut self, terminal_id: &TerminalId, bytes: &[u8]) -> Result<(), String> {
        self.sessions
            .get_mut(terminal_id)
            .ok_or_else(|| "terminal session not found".to_owned())?
            .writer
            .write_all(bytes)
            .map_err(|error| error.to_string())
    }

    fn resize(&mut self, terminal_id: &TerminalId, size: TerminalSize) -> Result<(), String> {
        if size.columns == 0 || size.rows == 0 {
            return Err("terminal dimensions must be non-zero".to_owned());
        }
        self.sessions
            .get(terminal_id)
            .ok_or_else(|| "terminal session not found".to_owned())?
            .master
            .resize(PtySize {
                rows: size.rows,
                cols: size.columns,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())
    }

    fn terminate(&mut self, terminal_id: &TerminalId) -> Result<(), String> {
        self.sessions
            .get_mut(terminal_id)
            .ok_or_else(|| "terminal session not found".to_owned())?
            .killer
            .kill()
            .map_err(|error| error.to_string())
    }
}

impl Drop for NativePtyAdapter {
    fn drop(&mut self) {
        for session in self.sessions.values_mut() {
            let _ = session.killer.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    #[cfg(unix)]
    use std::time::{Duration, Instant};

    #[test]
    fn rejects_unapproved_process_arguments() {
        let mut adapter = NativePtyAdapter::new();
        let result = adapter.spawn(&SpawnRequest {
            terminal_id: TerminalId::from("term_invalid"),
            executable: "/bin/sh",
            args: &[],
            cwd: PathBuf::from("."),
            size: TerminalSize {
                columns: 80,
                rows: 24,
            },
        });
        assert!(result.is_err());
    }

    #[test]
    fn accepts_the_fixed_powershell_arguments() {
        assert!(NativePtyAdapter::allowed_preset(&SpawnRequest {
            terminal_id: TerminalId::from("term_powershell"),
            executable: "powershell.exe",
            args: &["-NoLogo"],
            cwd: PathBuf::from("."),
            size: TerminalSize {
                columns: 80,
                rows: 24,
            },
        }));
    }

    #[test]
    fn accepts_the_fixed_windows_agent_arguments() {
        assert!(NativePtyAdapter::allowed_preset(&SpawnRequest {
            terminal_id: TerminalId::from("term_claude"),
            executable: "powershell.exe",
            args: &["-NoLogo", "-NoExit", "-Command", "claude"],
            cwd: PathBuf::from("."),
            size: TerminalSize {
                columns: 80,
                rows: 24,
            },
        }));
    }

    #[cfg(unix)]
    #[test]
    fn spawns_reads_resizes_and_exits_a_real_pty() {
        let mut adapter = NativePtyAdapter::new();
        let terminal_id = TerminalId::from("term_native");
        adapter
            .spawn(&SpawnRequest {
                terminal_id: terminal_id.clone(),
                executable: "bash",
                args: &["-l"],
                cwd: std::env::current_dir().expect("cwd"),
                size: TerminalSize {
                    columns: 80,
                    rows: 24,
                },
            })
            .expect("spawn bash PTY");
        adapter
            .resize(
                &terminal_id,
                TerminalSize {
                    columns: 100,
                    rows: 30,
                },
            )
            .expect("resize PTY");
        adapter
            .write(&terminal_id, b"printf native-pty\\n; exit 0\n")
            .expect("write PTY");

        let deadline = Instant::now() + Duration::from_secs(3);
        let mut output = Vec::new();
        let mut exited = false;
        while Instant::now() < deadline && !exited {
            for event in adapter.drain_events(32) {
                match event {
                    NativePtyEvent::Output { bytes, .. } => output.extend(bytes),
                    NativePtyEvent::Exited { exit_code, .. } => {
                        assert_eq!(exit_code, Some(0));
                        exited = true;
                    }
                }
            }
            if !exited {
                thread::sleep(Duration::from_millis(10));
            }
        }
        assert!(exited, "PTY did not exit before timeout");
        assert!(!adapter.contains(&terminal_id));
        assert!(String::from_utf8_lossy(&output).contains("native-pty"));
    }
}
