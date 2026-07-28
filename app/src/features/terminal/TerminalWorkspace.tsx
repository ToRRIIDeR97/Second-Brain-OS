import { useState, type KeyboardEvent } from "react";
import {
  TERMINAL_PRESETS,
  TERMINAL_TAB_LIMIT,
  TERMINAL_VIEW_MODES,
  type SelectedWorkspacePath,
  type TerminalFileLink,
  type TerminalOpenRequest,
  type TerminalPreset,
  type TerminalSession,
  type TerminalWorkspaceState,
} from "./types";
import {
  parseTerminalFileLink,
  resolveNewTerminalCwd,
  terminalReducer,
  type TerminalAction,
} from "./state";

export type TerminalWorkspaceProps = {
  state: TerminalWorkspaceState;
  selectedPath?: SelectedWorkspacePath;
  output?: Readonly<Record<string, string>>;
  screenReaderMode?: boolean;
  highContrast?: boolean;
  onChange: (state: TerminalWorkspaceState, action: TerminalAction) => void;
  onOpen: (request: TerminalOpenRequest) => void;
  onInput: (sessionId: string, input: string) => void;
  onOpenFile: (link: TerminalFileLink) => void;
  onResize?: (sessionId: string, columns: number, rows: number) => void;
};

const statusLabels: Record<TerminalSession["status"], string> = {
  running: "Running",
  waiting: "Waiting",
  exited: "Exited",
  restored: "Restored · inactive",
};

export function TerminalWorkspace({
  state,
  selectedPath,
  output = {},
  screenReaderMode = false,
  highContrast = false,
  onChange,
  onOpen,
  onInput,
  onOpenFile,
}: TerminalWorkspaceProps) {
  const [preset, setPreset] = useState<TerminalPreset>("shell");
  const active = state.sessions.find(({ id }) => id === state.activeSessionId);
  const dispatch = (action: TerminalAction) => {
    onChange(terminalReducer(state, action), action);
  };
  const activateAt = (index: number) => {
    const count = state.sessions.length;
    const session = state.sessions[(index + count) % count];
    if (session) dispatch({ type: "session/activate", id: session.id });
  };
  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    id: string,
  ) => {
    if (event.key === "ArrowRight") activateAt(index + 1);
    else if (event.key === "ArrowLeft") activateAt(index - 1);
    else if (event.key === "Home") activateAt(0);
    else if (event.key === "End") activateAt(state.sessions.length - 1);
    else if (event.key === "Delete") dispatch({ type: "session/close", id });
    else return;
    event.preventDefault();
  };

  return (
    <section
      aria-label="Terminal workspace"
      data-view-mode={state.viewMode}
      data-high-contrast={highContrast || undefined}
    >
      <div role="toolbar" aria-label="Terminal controls">
        <label>
          Preset
          <select
            value={preset}
            onChange={(event) => {
              setPreset(event.target.value as TerminalPreset);
            }}
          >
            {TERMINAL_PRESETS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={state.sessions.length >= TERMINAL_TAB_LIMIT}
          onClick={() => {
            onOpen({
              workspaceId: state.workspaceId,
              preset,
              cwd: resolveNewTerminalCwd(active, selectedPath),
            });
          }}
        >
          New terminal
        </button>
        <label>
          View
          <select
            value={state.viewMode}
            onChange={(event) => {
              dispatch({
                type: "view/set",
                viewMode: event.target
                  .value as TerminalWorkspaceState["viewMode"],
              });
            }}
          >
            {TERMINAL_VIEW_MODES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <output aria-live="polite">
          {state.sessions.length} of {TERMINAL_TAB_LIMIT} terminals
        </output>
      </div>

      <div role="tablist" aria-label="Terminal sessions">
        {state.sessions.map((session, index) => (
          <button
            type="button"
            role="tab"
            id={`terminal-tab-${session.id}`}
            aria-controls={`terminal-panel-${session.id}`}
            aria-selected={session.id === state.activeSessionId}
            tabIndex={session.id === state.activeSessionId ? 0 : -1}
            key={session.id}
            onClick={() => {
              dispatch({ type: "session/activate", id: session.id });
            }}
            onKeyDown={(event) => {
              onTabKeyDown(event, index, session.id);
            }}
          >
            {session.pinned ? "Pinned · " : ""}
            {session.title}
            {" · "}
            {statusLabels[session.status]}
            {" · CWD "}
            {session.cwdReliability}
            {session.agentLinked ? " · Agent linked" : ""}
          </button>
        ))}
      </div>

      {active ? (
        <>
          <div role="toolbar" aria-label="Active terminal tab">
            <label>
              Terminal title
              <input
                value={active.title}
                onChange={(event) => {
                  dispatch({
                    type: "session/rename",
                    id: active.id,
                    title: event.target.value,
                  });
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "session/pin", id: active.id });
              }}
            >
              {active.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "session/close", id: active.id });
              }}
            >
              Close
            </button>
          </div>
          <TerminalPane
            session={active}
            output={output[active.id] ?? ""}
            screenReaderMode={screenReaderMode}
            onInput={onInput}
            onOpenFile={onOpenFile}
          />
        </>
      ) : (
        <p>No terminal sessions are open.</p>
      )}
    </section>
  );
}

function TerminalPane({
  session,
  output,
  screenReaderMode,
  onInput,
  onOpenFile,
}: {
  session: TerminalSession;
  output: string;
  screenReaderMode: boolean;
  onInput: TerminalWorkspaceProps["onInput"];
  onOpenFile: TerminalWorkspaceProps["onOpenFile"];
}) {
  const [input, setInput] = useState("");
  const link = parseTerminalFileLink(
    session.workspaceId,
    output.trim(),
    session.cwd,
    session.cwdReliability,
  );
  return (
    <div
      role="tabpanel"
      id={`terminal-panel-${session.id}`}
      aria-labelledby={`terminal-tab-${session.id}`}
    >
      <pre
        aria-label="Terminal output"
        aria-live={screenReaderMode ? "polite" : "off"}
        tabIndex={0}
      >
        {output}
      </pre>
      {link ? (
        <button
          type="button"
          onClick={() => {
            onOpenFile(link);
          }}
        >
          Open {link.candidates[0]} at line {link.line}
        </button>
      ) : null}
      <label>
        Terminal input
        <textarea
          value={input}
          disabled={
            session.status === "exited" || session.status === "restored"
          }
          onChange={(event) => {
            setInput(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            onInput(session.id, `${input}\n`);
            setInput("");
          }}
        />
      </label>
    </div>
  );
}
