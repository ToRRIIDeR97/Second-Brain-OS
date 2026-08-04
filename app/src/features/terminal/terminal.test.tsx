import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalWorkspace } from "./TerminalWorkspace";
import { createMockIpc } from "../../lib/ipc";
import {
  parseTerminalFileLink,
  resolveNewTerminalCwd,
  terminalReducer,
} from "./state";
import type { TerminalSession, TerminalWorkspaceState } from "./types";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon(addon: { terminal?: unknown }) {
      addon.terminal = this;
    }
    open() {}
    write() {}
    focus() {}
    dispose() {}
    onData() {
      return { dispose() {} };
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    terminal?: { cols: number };
    fit() {
      if (this.terminal) this.terminal.cols += 1;
    }
  },
}));

const session = (
  id: string,
  overrides: Partial<TerminalSession> = {},
): TerminalSession => ({
  id,
  workspaceId: "workspace-1",
  title: id,
  preset: "shell",
  cwd: "packages/app",
  cwdReliability: "reliable",
  status: "running",
  pinned: false,
  agentLinked: false,
  ...overrides,
});

const state = (sessions: TerminalSession[]): TerminalWorkspaceState => ({
  workspaceId: "workspace-1",
  sessions,
  activeSessionId: sessions[0]?.id ?? null,
  viewMode: "drawer",
});

const success = (data: unknown) => ({
  contract: "ipc_result" as const,
  version: 1 as const,
  ok: true as const,
  data,
  correlationId: "terminal-test",
});

const nativeSession = {
  id: "native-1",
  workspaceId: "workspace-1",
  preset: "zsh",
  status: "running",
  cwd: { relativePath: "", reliable: true },
  size: { columns: 80, rows: 24 },
  exitCode: null,
  protected: false,
  busy: false,
  childProcesses: 0,
  bufferedBytes: 0,
  droppedBytes: 0,
};

describe("terminal workspace state", () => {
  it("waits until a panel drag ends before resizing the PTY", async () => {
    let notifyResize = () => {};
    const originalObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => {
          callback([], this);
        };
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const width = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(400);
    const height = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(300);
    const mock = createMockIpc();
    mock.setResponse("terminal_start", success(nativeSession));
    mock.setResponse(
      "terminal_read",
      success({ content: "", remainingBytes: 0, droppedBytes: 0 }),
    );

    const view = render(
      <TerminalWorkspace
        ipc={mock.client}
        request={{
          key: 1,
          workspaceId: "workspace-1",
          relativePath: "",
          preset: "zsh",
        }}
      />,
    );
    const resizeCount = () =>
      mock.calls.filter(({ command }) => command === "terminal_resize").length;
    await waitFor(() => {
      expect(resizeCount()).toBe(1);
    });

    const separator = document.createElement("div");
    separator.dataset.separator = "utility";
    document.body.append(separator);
    fireEvent.pointerDown(separator);
    notifyResize();
    await new Promise((resolve) => {
      window.setTimeout(resolve, 200);
    });
    expect(resizeCount()).toBe(1);
    window.dispatchEvent(new Event("pointerup"));
    await waitFor(() => {
      expect(resizeCount()).toBe(2);
    });

    separator.remove();
    view.unmount();
    width.mockRestore();
    height.mockRestore();
    globalThis.ResizeObserver = originalObserver;
  });

  it("confirms before terminating a native terminal", async () => {
    const mock = createMockIpc();
    mock.setResponse("terminal_start", success(nativeSession));
    mock.setResponse(
      "terminal_read",
      success({ content: "", remainingBytes: 0, droppedBytes: 0 }),
    );
    mock.setResponse("terminal_terminate", success(null));
    render(
      <TerminalWorkspace
        ipc={mock.client}
        request={{
          key: 2,
          workspaceId: "workspace-1",
          relativePath: "",
          preset: "zsh",
        }}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Close Terminal 1" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Close terminal?" }),
    ).toBeInTheDocument();
    expect(
      mock.calls.filter(({ command }) => command === "terminal_terminate"),
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Close Terminal 1" }),
      ).not.toBeInTheDocument();
    });
    const calls = mock.calls.filter(
      ({ command }) => command === "terminal_terminate",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toMatchObject({ confirmed: true });
  });

  it("enforces six sessions per workspace and preserves them across view modes", () => {
    const six = Array.from({ length: 6 }, (_, index) => session(String(index)));
    const unchanged = terminalReducer(state(six), {
      type: "session/open",
      session: session("overflow"),
    });
    expect(unchanged.sessions).toHaveLength(6);
    expect(
      terminalReducer(unchanged, {
        type: "session/open",
        session: session("foreign", { workspaceId: "workspace-2" }),
      }),
    ).toBe(unchanged);
    const moved = terminalReducer(unchanged, {
      type: "view/set",
      viewMode: "editor",
    });
    expect(moved.sessions).toBe(unchanged.sessions);
    expect(moved.viewMode).toBe("editor");
  });

  it("inherits reliable active CWD, then selected path, then workspace root", () => {
    expect(
      resolveNewTerminalCwd(session("active"), {
        relativePath: "notes/today.md",
        kind: "file",
      }),
    ).toBe("packages/app");
    expect(
      resolveNewTerminalCwd(
        session("active", { cwdReliability: "unreliable" }),
        { relativePath: "notes/today.md", kind: "file" },
      ),
    ).toBe("notes");
    expect(resolveNewTerminalCwd(undefined)).toBe("");
  });

  it("supports keyboard tab activation without restarting sessions", () => {
    const onChange = vi.fn();
    const sessions = [session("one"), session("two")];
    render(
      <TerminalWorkspace
        state={state(sessions)}
        onChange={onChange}
        onOpen={vi.fn()}
        onInput={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: /one/i }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions,
        activeSessionId: "two",
      }),
      { type: "session/activate", id: "two" },
    );
  });

  it("places the window title beside session tabs and exposes minimize", () => {
    const onMinimize = vi.fn();
    render(
      <TerminalWorkspace
        state={state([session("one", { title: "Terminal 1" })])}
        onChange={vi.fn()}
        onOpen={vi.fn()}
        onInput={vi.fn()}
        onOpenFile={vi.fn()}
        onMinimize={onMinimize}
      />,
    );

    const tablist = screen.getByRole("tablist", { name: "Terminals" });
    expect(tablist).toHaveTextContent("Terminal");
    expect(screen.getByRole("tab", { name: "Terminal 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Minimize terminal" }));
    expect(onMinimize).toHaveBeenCalledOnce();
  });
});

describe("terminal file links", () => {
  it("offers reported CWD before workspace root and carries line details", () => {
    expect(
      parseTerminalFileLink(
        "workspace-1",
        "src/main.ts:12:4",
        "packages/app",
        "reliable",
      ),
    ).toEqual({
      workspaceId: "workspace-1",
      candidates: ["packages/app/src/main.ts", "src/main.ts"],
      line: 12,
      column: 4,
    });
  });

  it("accepts native editor line fragments", () => {
    expect(
      parseTerminalFileLink(
        "workspace-1",
        "./docs/file.md#L50",
        "",
        "reliable",
      ),
    ).toEqual({
      workspaceId: "workspace-1",
      candidates: ["docs/file.md"],
      line: 50,
    });
  });

  it("rejects absolute, escaping, URI, and invalid line targets", () => {
    for (const link of [
      "/etc/passwd:1",
      "../secret:1",
      "file:///tmp/a:1",
      "C:\\secret.txt:1",
      "safe.ts:0",
    ])
      expect(
        parseTerminalFileLink("workspace-1", link, "packages/app", "reliable"),
      ).toBeNull();
  });
});
