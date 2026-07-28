import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type {
  IpcClient,
  NativeTerminalPreset,
  NativeTerminalSession,
} from "../../lib/ipc";
import { terminalReducer, type TerminalAction } from "./state";
import type {
  TerminalFileLink,
  TerminalOpenRequest,
  TerminalWorkspaceState,
} from "./types";
import "@xterm/xterm/css/xterm.css";

export type TerminalRequest = {
  key: number;
  workspaceId: string;
  relativePath: string;
  preset: NativeTerminalPreset;
};

function TerminalPane({
  ipc,
  session,
  active,
  initialOutput,
  onOutput,
}: {
  ipc: IpcClient;
  session: NativeTerminalSession;
  active: boolean;
  initialOutput: string;
  onOutput: (sessionId: string, chunk: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const initialOutputRef = useRef(initialOutput);
  activeRef.current = active;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let pollTimer = 0;
    let resizeFrame = 0;
    let lastColumns = 0;
    let lastRows = 0;
    let observer: ResizeObserver | undefined;
    let disposeTerminal: (() => void) | undefined;

    const connect = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;
      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily:
          '"SFMono-Regular", "Cascadia Code", "Roboto Mono", Menlo, monospace',
        fontSize: 12,
        lineHeight: 1.25,
        scrollback: 5_000,
        theme: {
          background: "#0d1118",
          foreground: "#dce3ef",
          cursor: "#c3b1ff",
          selectionBackground: "#534a78",
          black: "#111722",
          brightBlack: "#6f7888",
          red: "#f28f9c",
          green: "#7fd4aa",
          yellow: "#e7c56d",
          blue: "#8db4ef",
          magenta: "#c3a7f5",
          cyan: "#78cfdb",
          white: "#dce3ef",
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(element);
      if (initialOutputRef.current) terminal.write(initialOutputRef.current);

      const fitAndResize = () => {
        if (disposed || element.clientWidth < 20 || element.clientHeight < 20)
          return;
        fit.fit();
        if (terminal.cols === lastColumns && terminal.rows === lastRows) return;
        lastColumns = terminal.cols;
        lastRows = terminal.rows;
        void ipc.terminal.resize(
          session.workspaceId,
          session.id,
          terminal.cols,
          terminal.rows,
        );
      };
      const scheduleFit = () => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(fitAndResize);
      };
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(scheduleFit);
        observer.observe(element);
      }
      resizeFrame = window.requestAnimationFrame(() => {
        fitAndResize();
        if (activeRef.current) terminal.focus();
      });

      const input = terminal.onData((data) => {
        void ipc.terminal.write(session.workspaceId, session.id, data);
      });
      const poll = async () => {
        const result = await ipc.terminal.read(session.workspaceId, session.id);
        if (result.ok && result.data.content) {
          terminal.write(result.data.content);
          onOutput(session.id, result.data.content);
        }
      };
      pollTimer = window.setInterval(() => void poll(), 80);
      void poll();

      disposeTerminal = () => {
        input.dispose();
        terminal.dispose();
      };
    };

    void connect();
    return () => {
      disposed = true;
      window.clearInterval(pollTimer);
      window.cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      disposeTerminal?.();
    };
  }, [ipc, onOutput, session.id, session.workspaceId]);

  return (
    <div
      ref={host}
      className="terminal-emulator"
      aria-label={`Terminal ${session.id}`}
      onMouseDown={() => {
        host.current
          ?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
          ?.focus();
      }}
    />
  );
}

type NativeTerminalWorkspaceProps = {
  ipc: IpcClient;
  request?: TerminalRequest | undefined;
};

type ControlledTerminalWorkspaceProps = {
  state: TerminalWorkspaceState;
  onChange: (state: TerminalWorkspaceState, action: TerminalAction) => void;
  onOpen: (request: TerminalOpenRequest) => void;
  onInput: (sessionId: string, input: string) => void;
  onOpenFile: (link: TerminalFileLink) => void;
};

export type TerminalWorkspaceProps =
  | NativeTerminalWorkspaceProps
  | ControlledTerminalWorkspaceProps;

function ControlledTerminalTabs({
  state,
  onChange,
}: ControlledTerminalWorkspaceProps) {
  const activate = (id: string) => {
    const action: TerminalAction = { type: "session/activate", id };
    onChange(terminalReducer(state, action), action);
  };
  return (
    <section className="terminal-workspace" aria-label="Terminal workspace">
      <div className="terminal-tabbar" role="tablist" aria-label="Terminals">
        {state.sessions.map((session, index) => (
          <div
            key={session.id}
            className="terminal-tab"
            data-active={state.activeSessionId === session.id}
          >
            <button
              type="button"
              role="tab"
              aria-selected={state.activeSessionId === session.id}
              onClick={() => {
                activate(session.id);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
                  return;
                event.preventDefault();
                const offset = event.key === "ArrowRight" ? 1 : -1;
                const next =
                  state.sessions[
                    (index + offset + state.sessions.length) %
                      state.sessions.length
                  ];
                if (next) activate(next.id);
              }}
            >
              {session.title}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function NativeTerminalWorkspace({
  ipc,
  request,
}: NativeTerminalWorkspaceProps) {
  const [sessions, setSessions] = useState<NativeTerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [splitIds, setSplitIds] = useState<string[]>([]);
  const [draggedId, setDraggedId] = useState<string>();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [outputHistory, setOutputHistory] = useState<Record<string, string>>(
    {},
  );
  const startedRequest = useRef<number | undefined>(undefined);

  const rememberOutput = useCallback((sessionId: string, chunk: string) => {
    setOutputHistory((current) => ({
      ...current,
      [sessionId]: ((current[sessionId] ?? "") + chunk).slice(-1_000_000),
    }));
  }, []);

  const addSession = useCallback(
    async (
      workspaceId?: string,
      relativePath?: string,
      preset: NativeTerminalPreset = "zsh",
    ) => {
      let targetWorkspaceId = workspaceId;
      if (!targetWorkspaceId) {
        const result = await ipc.workspaces.list();
        const workspace = result.ok
          ? result.data.find((item) => item.canUseTerminal)
          : undefined;
        if (!workspace) {
          setError(
            result.ok
              ? "Open a trusted workspace to start a terminal."
              : result.error.message,
          );
          return;
        }
        targetWorkspaceId = workspace.id;
      }
      const result = await ipc.terminal.start(
        targetWorkspaceId,
        relativePath ?? "",
        preset,
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setError("");
      setSessions((current) => [
        ...current.filter(({ id }) => id !== result.data.id),
        result.data,
      ]);
      setActiveId(result.data.id);
    },
    [ipc],
  );

  useEffect(() => {
    if (request) {
      if (startedRequest.current === request.key) return;
      const timer = window.setTimeout(() => {
        if (startedRequest.current === request.key) return;
        startedRequest.current = request.key;
        void addSession(
          request.workspaceId,
          request.relativePath,
          request.preset,
        );
      });
      return () => {
        window.clearTimeout(timer);
      };
    }
    if (startedRequest.current !== undefined) return;
    const timer = window.setTimeout(() => {
      if (startedRequest.current !== undefined) return;
      startedRequest.current = 0;
      void addSession();
    });
    return () => {
      window.clearTimeout(timer);
    };
  }, [addSession, request]);

  const closeSession = useCallback(
    (session: NativeTerminalSession) => {
      void ipc.terminal.terminate(session.workspaceId, session.id, true);
      setOutputHistory((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => id !== session.id),
        ),
      );
      setSessions((current) => {
        const remaining = current.filter(({ id }) => id !== session.id);
        setActiveId((selected) =>
          selected === session.id ? remaining.at(-1)?.id : selected,
        );
        return remaining;
      });
      setSplitIds((current) => current.filter((id) => id !== session.id));
    },
    [ipc],
  );

  const splitWith = useCallback(
    (id: string) => {
      const anchor = activeId && activeId !== id ? activeId : sessions[0]?.id;
      if (!anchor || anchor === id) return;
      // ponytail: Two visible panes is an intentional product ceiling; tabs
      // remain unbounded without multiplying concurrent terminal renderers.
      setSplitIds([anchor, id]);
      setActiveId(id);
    },
    [activeId, sessions],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (draggedId) splitWith(draggedId);
    setDraggedId(undefined);
  };

  const visibleIds =
    splitIds.length === 2
      ? splitIds
      : activeId
        ? [activeId]
        : sessions[0]
          ? [sessions[0].id]
          : [];

  return (
    <section className="terminal-workspace" aria-label="Terminal workspace">
      <div className="terminal-tabbar" role="tablist" aria-label="Terminals">
        {sessions.map((session, index) => (
          <div
            key={session.id}
            className="terminal-tab"
            data-active={visibleIds.includes(session.id)}
            draggable
            onDragStart={() => {
              setDraggedId(session.id);
            }}
            onDragEnd={() => {
              setDraggedId(undefined);
              setDragOver(false);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeId === session.id}
              onClick={() => {
                setActiveId(session.id);
                setSplitIds([]);
              }}
            >
              <span className="terminal-status-dot" />
              Terminal {index + 1}
            </button>
            <button
              type="button"
              className="terminal-tab-close"
              aria-label={`Close Terminal ${String(index + 1)}`}
              onClick={() => {
                closeSession(session);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="terminal-add"
          aria-label="New terminal"
          title="New terminal"
          onClick={() => {
            const active = sessions.find(({ id }) => id === activeId);
            void addSession(
              active?.workspaceId,
              active?.cwd.relativePath,
              "zsh",
            );
          }}
        >
          +
        </button>
        {sessions.length > 1 && activeId ? (
          <button
            type="button"
            className="terminal-split"
            title="Split with another terminal"
            onClick={() => {
              const other = sessions.find(({ id }) => id !== activeId);
              if (other) splitWith(other.id);
            }}
          >
            Split
          </button>
        ) : null}
      </div>

      <div
        className="terminal-stage"
        data-drag-over={dragOver}
        onDragEnter={() => {
          if (draggedId) setDragOver(true);
        }}
        onDragOver={(event) => {
          if (draggedId) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            setDragOver(false);
        }}
        onDrop={onDrop}
      >
        {visibleIds.length ? (
          <Group orientation="horizontal" className="terminal-split-group">
            {visibleIds.map((id, index) => {
              const session = sessions.find((item) => item.id === id);
              if (!session) return null;
              return (
                <Fragment key={id}>
                  {index > 0 ? (
                    <Separator
                      className="terminal-split-handle"
                      aria-label="Resize terminal split"
                    />
                  ) : null}
                  <Panel minSize="20%">
                    <TerminalPane
                      ipc={ipc}
                      session={session}
                      active={activeId === id}
                      initialOutput={outputHistory[id] ?? ""}
                      onOutput={rememberOutput}
                    />
                  </Panel>
                </Fragment>
              );
            })}
          </Group>
        ) : (
          <div className="terminal-empty" role={error ? "alert" : "status"}>
            {error || "Starting terminal…"}
          </div>
        )}
        {dragOver ? (
          <div className="terminal-drop-hint">Drop to split terminal</div>
        ) : null}
      </div>
    </section>
  );
}

export function TerminalWorkspace(props: TerminalWorkspaceProps) {
  return "state" in props ? (
    <ControlledTerminalTabs {...props} />
  ) : (
    <NativeTerminalWorkspace {...props} />
  );
}
