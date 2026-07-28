export const TERMINAL_TAB_LIMIT = 6;

export const TERMINAL_PRESETS = [
  "shell",
  "codex",
  "claude",
  "server",
  "test",
  "custom",
] as const;

export const TERMINAL_VIEW_MODES = [
  "activity",
  "editor",
  "drawer",
  "window",
] as const;

export type TerminalPreset = (typeof TERMINAL_PRESETS)[number];
export type TerminalViewMode = (typeof TERMINAL_VIEW_MODES)[number];
export type TerminalStatus = "running" | "waiting" | "exited" | "restored";
export type CwdReliability = "reliable" | "unreliable";

export type TerminalSession = {
  id: string;
  workspaceId: string;
  title: string;
  preset: TerminalPreset;
  cwd: string;
  cwdReliability: CwdReliability;
  status: TerminalStatus;
  pinned: boolean;
  agentLinked: boolean;
  exitCode?: number;
};

export type TerminalWorkspaceState = {
  workspaceId: string;
  sessions: TerminalSession[];
  activeSessionId: string | null;
  viewMode: TerminalViewMode;
};

export type SelectedWorkspacePath = {
  relativePath: string;
  kind: "file" | "folder";
};

export type TerminalOpenRequest = {
  workspaceId: string;
  preset: TerminalPreset;
  cwd: string;
};

export type TerminalFileLink = {
  workspaceId: string;
  candidates: string[];
  line: number;
  column?: number;
};
