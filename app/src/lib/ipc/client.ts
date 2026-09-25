import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  ActivityListRequest,
  ActivityPage,
  CommandResult,
  FileAttachmentCreateRequest,
  FileAttachmentCreateResult,
  FileAttachmentReadResult,
  FileReadResult,
  FileWriteRequest,
  FileWriteResult,
  GitWorkspaceDiff,
  GitFileDiff,
  GitWorkspaceStatus,
  JobCancellation,
  LanguageDiagnostic,
  LanguageFormatResult,
  LanguageToolStatus,
  IntegrationSettings,
  IntegrationSettingsUpdate,
  GoogleConnectionStatus,
  GoogleSyncSummary,
  LspServerKind,
  LspSessionSummary,
  NativeTerminalOutput,
  NativeTerminalPreset,
  NativeTerminalSession,
  PlannerCreateRequest,
  PlannerItemRecord,
  PlannerItemPatchRecord,
  PlannerListRequest,
  AgentProviderProbeRecord,
  ManagedAgentApprovalRequest,
  ManagedAgentMessageRequest,
  ManagedAgentSessionRecord,
  ManagedAgentSessionRequest,
  ManagedAgentStartRequest,
  ProjectCreateRequest,
  ProjectPatch,
  ProjectRecord,
  ProjectStatus,
  RendererDiagnostic,
  RootSelection,
  ShellLayout,
  WorkspaceDirectoryPage,
  WorkspaceGraphPage,
  WorkspacePath,
  WorkspaceRegistration,
  WorkspaceSearchResponse,
  WorkspaceSummary,
  ToolLanguage,
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
      log: (diagnostic: RendererDiagnostic) =>
        call<null>("system_log", { diagnostic }),
      ping: () => call<string>("system_ping"),
      sampleError: () => call<null>("system_sample_error"),
    },
    shell: {
      loadLayout: () => call<ShellLayout | null>("shell_load_layout"),
      saveLayout: (layout: ShellLayout) =>
        call<ShellLayout>("shell_save_layout", { layout }),
    },
    integrations: {
      get: () => call<IntegrationSettings>("integration_settings_get"),
      save: (update: IntegrationSettingsUpdate) =>
        call<IntegrationSettings>("integration_settings_save", { update }),
      googleStatus: () =>
        call<GoogleConnectionStatus>("google_connection_status_get"),
      googleConnect: (brainWorkspaceId: string) =>
        call<GoogleSyncSummary>("google_connect", { brainWorkspaceId }),
      googleSync: (brainWorkspaceId: string) =>
        call<GoogleSyncSummary>("google_sync", { brainWorkspaceId }),
      googleDisconnect: () => call<GoogleConnectionStatus>("google_disconnect"),
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
      selectRoot: () => call<RootSelection | null>("workspace_select_root"),
      register: (registration: WorkspaceRegistration) =>
        call<WorkspaceSummary>("workspace_register", { registration }),
      listDirectory: (path: WorkspacePath, cursor?: number, limit?: number) =>
        call<WorkspaceDirectoryPage>("workspace_list_directory", {
          path,
          cursor,
          limit,
        }),
    },
    projects: {
      list: (brainWorkspaceId: string) =>
        call<ProjectRecord[]>("project_list", { brainWorkspaceId }),
      get: (brainWorkspaceId: string, projectId: string) =>
        call<ProjectRecord>("project_get", {
          request: { brainWorkspaceId, projectId },
        }),
      create: (request: ProjectCreateRequest) =>
        call<ProjectRecord>("project_create", { request }),
      update: (
        brainWorkspaceId: string,
        projectId: string,
        patch: ProjectPatch,
      ) =>
        call<ProjectRecord>("project_update", {
          request: { brainWorkspaceId, projectId, patch },
        }),
      setStatus: (
        brainWorkspaceId: string,
        projectId: string,
        status: ProjectStatus,
      ) =>
        call<ProjectRecord>("project_set_status", {
          request: { brainWorkspaceId, projectId, status },
        }),
    },
    activity: {
      list: (request: ActivityListRequest) =>
        call<ActivityPage>("activity_list", { request }),
    },
    planner: {
      list: (request: PlannerListRequest) =>
        call<PlannerItemRecord[]>("planner_list", { request }),
      create: (request: PlannerCreateRequest) =>
        call<PlannerItemRecord>("planner_create", { request }),
      update: (
        brainWorkspaceId: string,
        itemId: string,
        patch: PlannerItemPatchRecord,
      ) =>
        call<PlannerItemRecord>("planner_update", {
          request: { brainWorkspaceId, itemId, patch },
        }),
      delete: (brainWorkspaceId: string, itemId: string) =>
        call<null>("planner_delete", {
          request: { brainWorkspaceId, itemId },
        }),
    },
    agents: {
      probe: () => call<AgentProviderProbeRecord>("agent_provider_probe"),
      list: (workspaceId: string) =>
        call<ManagedAgentSessionRecord[]>("agent_session_list", {
          workspaceId,
        }),
      start: (request: ManagedAgentStartRequest) =>
        call<ManagedAgentSessionRecord>("agent_session_start", { request }),
      message: (request: ManagedAgentMessageRequest) =>
        call<null>("agent_session_message", { request }),
      cancel: (request: ManagedAgentSessionRequest) =>
        call<null>("agent_session_cancel", { request }),
      decideApproval: (request: ManagedAgentApprovalRequest) =>
        call<null>("agent_approval_decide", { request }),
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
      fileDiff: (workspaceId: string, staged: boolean, path: string) =>
        call<GitFileDiff>("git_file_diff", { workspaceId, staged, path }),
      stage: (workspaceId: string, paths: string[]) =>
        call<null>("git_stage", { workspaceId, paths }),
      unstage: (workspaceId: string, paths: string[]) =>
        call<null>("git_unstage", { workspaceId, paths }),
      discard: (workspaceId: string, paths: string[], confirmed: boolean) =>
        call<null>("git_discard", { workspaceId, paths, confirmed }),
    },
    languageTools: {
      status: (workspaceId: string) =>
        call<LanguageToolStatus[]>("language_tools_status", { workspaceId }),
      format: (
        workspaceId: string,
        relativePath: string,
        language: ToolLanguage,
        content: string,
      ) =>
        call<LanguageFormatResult>("language_format", {
          workspaceId,
          relativePath,
          language,
          content,
        }),
      analyze: (workspaceId: string, language?: ToolLanguage) =>
        call<LanguageDiagnostic[]>("language_analyze", {
          workspaceId,
          language,
        }),
    },
    lsp: {
      start: (workspaceId: string, server: LspServerKind) =>
        call<LspSessionSummary>("lsp_start", { workspaceId, server }),
      send: (workspaceId: string, sessionId: string, message: unknown) =>
        call<null>("lsp_send", { workspaceId, sessionId, message }),
      receive: (workspaceId: string, sessionId: string, timeoutMs = 100) =>
        call<unknown>("lsp_receive", {
          workspaceId,
          sessionId,
          timeoutMs,
        }),
      stop: (workspaceId: string, sessionId: string) =>
        call<LspSessionSummary>("lsp_stop", { workspaceId, sessionId }),
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
        preset?: NativeTerminalPreset,
      ) =>
        call<NativeTerminalSession>("terminal_start", {
          workspaceId,
          relativePath,
          ...(preset ? { preset } : {}),
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
