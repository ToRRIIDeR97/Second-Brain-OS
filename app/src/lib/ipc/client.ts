import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  CommandResult,
  FileAttachmentCreateRequest,
  FileAttachmentCreateResult,
  FileAttachmentReadResult,
  FileReadResult,
  FileWriteRequest,
  FileWriteResult,
  GitWorkspaceDiff,
  GitWorkspaceStatus,
  JobCancellation,
  NativeTerminalOutput,
  NativeTerminalPreset,
  NativeTerminalSession,
  ShellLayout,
  WorkspaceDirectoryPage,
  WorkspaceGraphPage,
  WorkspacePath,
  WorkspaceRegistration,
  WorkspaceSearchResponse,
  WorkspaceSummary,
} from "./types";
import { isCommandResult, protocolError } from "./types";

export type InvokePort = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

const tauriPort: InvokePort = <T>(
  command: string,
  args?: Record<string, unknown>,
) => tauriInvoke<T>(command, args);

export type IpcClient = ReturnType<typeof createIpcClient>;

/** The only frontend module allowed to import Tauri's invoke function. */
export function createIpcClient(invoke: InvokePort = tauriPort) {
  async function call<T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<CommandResult<T>> {
    try {
      const value: unknown = await invoke<unknown>(command, args);
      return isCommandResult<T>(value)
        ? value
        : protocolError(
            `Command ${command} returned an invalid result envelope.`,
          );
    } catch (cause) {
      return {
        contract: "ipc_result",
        version: 1,
        ok: false,
        error: {
          code: "IPC_UNAVAILABLE",
          message:
            cause instanceof Error
              ? cause.message
              : "The desktop bridge is unavailable.",
          retryable: true,
        },
        correlationId: `ipc-${Date.now().toString(36)}`,
      };
    }
  }

  return {
    system: {
      ping: () => call<string>("system_ping"),
      sampleError: () => call<null>("system_sample_error"),
    },
    shell: {
      loadLayout: () => call<ShellLayout | null>("shell_load_layout"),
      saveLayout: (layout: ShellLayout) =>
        call<ShellLayout>("shell_save_layout", { layout }),
    },
    files: {
      readText: (path: WorkspacePath) =>
        call<FileReadResult>("file_read_text", { path }),
      createAttachment: (request: FileAttachmentCreateRequest) =>
        call<FileAttachmentCreateResult>("file_create_attachment", { request }),
      readAttachment: (path: WorkspacePath) =>
        call<FileAttachmentReadResult>("file_read_attachment", { path }),
      writeText: (request: FileWriteRequest) =>
        call<FileWriteResult>("file_write_text", { request }),
    },
    jobs: {
      cancel: (jobId: string) => call<JobCancellation>("job_cancel", { jobId }),
    },
    workspaces: {
      list: () => call<WorkspaceSummary[]>("workspace_list"),
      register: (registration: WorkspaceRegistration) =>
        call<WorkspaceSummary>("workspace_register", { registration }),
      listDirectory: (path: WorkspacePath, cursor?: number, limit?: number) =>
        call<WorkspaceDirectoryPage>("workspace_list_directory", {
          path,
          cursor,
          limit,
        }),
    },
    git: {
      status: (workspaceId: string) =>
        call<GitWorkspaceStatus>("git_status", { workspaceId }),
      diff: (workspaceId: string, staged: boolean, relativePaths: string[]) =>
        call<GitWorkspaceDiff>("git_diff", {
          workspaceId,
          staged,
          paths: relativePaths,
        }),
      stage: (workspaceId: string, paths: string[]) =>
        call<null>("git_stage", { workspaceId, paths }),
      unstage: (workspaceId: string, paths: string[]) =>
        call<null>("git_unstage", { workspaceId, paths }),
      discard: (workspaceId: string, paths: string[], confirmed: boolean) =>
        call<null>("git_discard", { workspaceId, paths, confirmed }),
    },
    knowledge: {
      search: (workspaceId: string, query: string) =>
        call<WorkspaceSearchResponse>("workspace_search", {
          workspaceId,
          query,
        }),
      graph: (workspaceId: string, relativePath = "", expandNodeId?: string) =>
        call<WorkspaceGraphPage>("workspace_graph", {
          workspaceId,
          relativePath,
          expandNodeId,
        }),
    },
    terminal: {
      start: (
        workspaceId: string,
        relativePath = "",
        preset: NativeTerminalPreset = "zsh",
      ) =>
        call<NativeTerminalSession>("terminal_start", {
          workspaceId,
          relativePath,
          preset,
        }),
      sessions: (workspaceId: string) =>
        call<NativeTerminalSession[]>("terminal_sessions", { workspaceId }),
      write: (workspaceId: string, terminalId: string, input: string) =>
        call<null>("terminal_write", { workspaceId, terminalId, input }),
      read: (workspaceId: string, terminalId: string, maxBytes = 65_536) =>
        call<NativeTerminalOutput>("terminal_read", {
          workspaceId,
          terminalId,
          maxBytes,
        }),
      resize: (
        workspaceId: string,
        terminalId: string,
        columns: number,
        rows: number,
      ) =>
        call<null>("terminal_resize", {
          workspaceId,
          terminalId,
          columns,
          rows,
        }),
      terminate: (
        workspaceId: string,
        terminalId: string,
        confirmed: boolean,
      ) =>
        call<null>("terminal_terminate", {
          workspaceId,
          terminalId,
          confirmed,
        }),
    },
  };
}

export const ipcClient = createIpcClient();
export const ipc = ipcClient;
