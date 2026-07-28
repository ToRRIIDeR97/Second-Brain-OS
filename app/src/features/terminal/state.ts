import {
  TERMINAL_TAB_LIMIT,
  type SelectedWorkspacePath,
  type TerminalFileLink,
  type TerminalSession,
  type TerminalViewMode,
  type TerminalWorkspaceState,
} from "./types";

export type TerminalAction =
  | { type: "session/open"; session: TerminalSession }
  | { type: "session/activate"; id: string }
  | { type: "session/close"; id: string }
  | { type: "session/rename"; id: string; title: string }
  | { type: "session/pin"; id: string }
  | {
      type: "session/status";
      id: string;
      status: TerminalSession["status"];
      exitCode?: number;
    }
  | {
      type: "session/cwd";
      id: string;
      cwd: string;
      reliability: TerminalSession["cwdReliability"];
    }
  | { type: "view/set"; viewMode: TerminalViewMode };

export function terminalReducer(
  state: TerminalWorkspaceState,
  action: TerminalAction,
): TerminalWorkspaceState {
  switch (action.type) {
    case "session/open":
      if (
        action.session.workspaceId !== state.workspaceId ||
        state.sessions.length >= TERMINAL_TAB_LIMIT ||
        state.sessions.some(({ id }) => id === action.session.id)
      )
        return state;
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        activeSessionId: action.session.id,
      };
    case "session/activate":
      return state.sessions.some(({ id }) => id === action.id)
        ? { ...state, activeSessionId: action.id }
        : state;
    case "session/close": {
      const index = state.sessions.findIndex(({ id }) => id === action.id);
      if (index < 0) return state;
      const sessions = state.sessions.filter(({ id }) => id !== action.id);
      const activeSessionId =
        state.activeSessionId === action.id
          ? (sessions[Math.min(index, sessions.length - 1)]?.id ?? null)
          : state.activeSessionId;
      return { ...state, sessions, activeSessionId };
    }
    case "session/rename": {
      if (!action.title.trim()) return state;
      return updateSession(state, action.id, (session) => ({
        ...session,
        title: action.title,
      }));
    }
    case "session/pin":
      return updateSession(state, action.id, (session) => ({
        ...session,
        pinned: !session.pinned,
      }));
    case "session/status":
      return updateSession(state, action.id, (session) => {
        const next = { ...session, status: action.status };
        if (action.exitCode === undefined) {
          delete next.exitCode;
        } else {
          next.exitCode = action.exitCode;
        }
        return next;
      });
    case "session/cwd": {
      const cwd = normalizeWorkspacePath(action.cwd);
      if (cwd === null) return state;
      return updateSession(state, action.id, (session) => ({
        ...session,
        cwd,
        cwdReliability: action.reliability,
      }));
    }
    case "view/set":
      return { ...state, viewMode: action.viewMode };
  }
}

function updateSession(
  state: TerminalWorkspaceState,
  id: string,
  update: (session: TerminalSession) => TerminalSession,
) {
  if (!state.sessions.some((session) => session.id === id)) return state;
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id ? update(session) : session,
    ),
  };
}

function hasControlCharacter(value: string) {
  for (const character of value) if (character.charCodeAt(0) < 32) return true;
  return false;
}

export function normalizeWorkspacePath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").trim();
  if (
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized)
  )
    return null;
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === ".." || hasControlCharacter(part)))
    return null;
  return parts.join("/");
}

function joinWorkspacePath(base: string, path: string) {
  return normalizeWorkspacePath(base ? `${base}/${path}` : path);
}

export function resolveNewTerminalCwd(
  active: TerminalSession | undefined,
  selected?: SelectedWorkspacePath,
): string {
  if (active?.cwdReliability === "reliable") {
    const cwd = normalizeWorkspacePath(active.cwd);
    if (cwd !== null) return cwd;
  }
  if (selected) {
    const path = normalizeWorkspacePath(selected.relativePath);
    if (path !== null)
      return selected.kind === "folder"
        ? path
        : path.split("/").slice(0, -1).join("/");
  }
  return "";
}

export function parseTerminalFileLink(
  workspaceId: string,
  value: string,
  cwd: string,
  cwdReliability: TerminalSession["cwdReliability"],
): TerminalFileLink | null {
  const match = value
    .trim()
    .match(
      /^(?:"([^"]+)"|'([^']+)'|(.+?))(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?)$/,
    );
  if (!match) return null;
  const path = normalizeWorkspacePath(match[1] ?? match[2] ?? match[3] ?? "");
  const line = Number(match[4] ?? match[6]);
  const rawColumn = match[5] ?? match[7];
  const column = rawColumn === undefined ? undefined : Number(rawColumn);
  if (
    path === null ||
    !path ||
    !Number.isSafeInteger(line) ||
    line < 1 ||
    (column !== undefined && (!Number.isSafeInteger(column) || column < 1))
  )
    return null;

  const candidates: string[] = [];
  if (cwdReliability === "reliable") {
    const relativeToCwd = joinWorkspacePath(cwd, path);
    if (relativeToCwd) candidates.push(relativeToCwd);
  }
  if (!candidates.includes(path)) candidates.push(path);
  return {
    workspaceId,
    candidates,
    line,
    ...(column === undefined ? {} : { column }),
  };
}
