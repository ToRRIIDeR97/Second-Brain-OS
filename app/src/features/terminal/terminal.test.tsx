import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { TerminalWorkspace } from "./TerminalWorkspace";
import {
  parseTerminalFileLink,
  resolveNewTerminalCwd,
  terminalReducer,
} from "./state";
import type { TerminalSession, TerminalWorkspaceState } from "./types";

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

describe("terminal workspace state", () => {
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
