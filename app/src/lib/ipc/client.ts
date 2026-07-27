import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  CommandResult,
  FileReadResult,
  FileWriteRequest,
  FileWriteResult,
  JobCancellation,
  ShellLayout,
  WorkspacePath,
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
      writeText: (request: FileWriteRequest) =>
        call<FileWriteResult>("file_write_text", { request }),
    },
    jobs: {
      cancel: (jobId: string) => call<JobCancellation>("job_cancel", { jobId }),
    },
  };
}

export const ipcClient = createIpcClient();
export const ipc = ipcClient;
