import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMockIpc } from "../../lib/ipc";
import { AgentWorkspace } from "./AgentWorkspace";
import { agentReducer, statusLabel } from "./model";
import {
  createIpcAgentSessionSource,
  unavailableAgentSessionSource,
} from "./source";
import type {
  AgentSession,
  AgentSessionSource,
  AgentWorkspaceState,
} from "./types";

const session = (overrides: Partial<AgentSession> = {}): AgentSession => ({
  id: "agent-1",
  workspaceId: "workspace-1",
  provider: "codex",
  mode: "managed",
  profileId: "developer",
  packetId: "packet-1",
  objective: "Review the index",
  roots: {
    readable: [{ projectId: "primary", relativePath: "." }],
    writable: [{ projectId: "primary", relativePath: "src" }],
    writableProjectId: "primary",
  },
  state: "waiting",
  assistantText: "I need permission.",
  pendingApprovals: [
    {
      approvalId: "approval-1",
      riskClass: "local_reversible_write",
      summary: "Update index",
      target: "src/index.rs",
      decision: "pending",
    },
  ],
  fileChanges: [],
  validations: [],
  ...overrides,
});

const state = (sessions: AgentSession[]): AgentWorkspaceState => ({
  workspaceId: "workspace-1",
  sessions,
  activeSessionId: sessions[0]?.id ?? null,
});

describe("agent session model", () => {
  it("cancels active sessions and resumes after an approval decision", () => {
    const initial = state([session()]);
    const canceled = agentReducer(initial, {
      type: "session/cancel",
      id: "agent-1",
    });
    expect(canceled.sessions[0]?.state).toBe("canceling");
    const approved = agentReducer(initial, {
      type: "approval/decide",
      sessionId: "agent-1",
      approvalId: "approval-1",
      decision: "approved",
    });
    expect(approved.sessions[0]?.state).toBe("running");
    expect(approved.sessions[0]?.pendingApprovals).toHaveLength(0);
  });

  it("renders packet, roots, approval controls, and cancellation", () => {
    const onChange = vi.fn();
    const onCancel = vi.fn();
    const onApprove = vi.fn();
    render(
      <AgentWorkspace
        state={state([session()])}
        onChange={onChange}
        onCancel={onCancel}
        onApprove={onApprove}
        sessionSource={unavailableAgentSessionSource}
      />,
    );
    expect(screen.getByText("Context packet: packet-1")).toBeInTheDocument();
    expect(screen.getByText("primary:.")).toBeInTheDocument();
    expect(screen.getByText("primary:src")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    expect(onApprove).toHaveBeenCalledWith("agent-1", "approval-1", "approved");
    expect(onCancel).toHaveBeenCalledWith("agent-1");
  });

  it("continues a completed managed session through its scoped source", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true as const });
    const source: AgentSessionSource = {
      ...unavailableAgentSessionSource,
      availability: { status: "available" },
      probe: () => Promise.resolve({ status: "available" }),
      list: () => Promise.resolve([]),
      subscribe: () => () => undefined,
      sendMessage,
    };
    const onChange = vi.fn();
    render(
      <AgentWorkspace
        state={state([
          session({
            state: "completed",
            pendingApprovals: [],
            assistantText: "Initial result",
          }),
        ])}
        onChange={onChange}
        sessionSource={source}
      />,
    );

    fireEvent.change(screen.getByLabelText("Continue this session"), {
      target: { value: "Check the edge cases" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        "workspace-1",
        "agent-1",
        "Check the edge cases",
      );
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: [expect.objectContaining({ state: "starting" })],
      }),
      { type: "session/state", id: "agent-1", state: "starting" },
    );
  });

  it("normalizes persisted IPC sessions and deduplicates polled events", async () => {
    vi.useFakeTimers();
    const mock = createMockIpc();
    const record = {
      ...session({ pendingApprovals: [] }),
      events: [
        {
          id: "event-1",
          sessionId: "agent-1",
          occurredAt: "2026-08-22T00:00:00Z",
          type: "assistant" as const,
          text: "Ready",
        },
      ],
      lastActivityAt: null,
      currentAction: null,
      error: null,
    };
    mock.setResponse("agent_session_list", success([record]));
    const source = createIpcAgentSessionSource(mock.client);
    const listener = vi.fn();

    await expect(source.list("workspace-1")).resolves.toMatchObject([
      { id: "agent-1", events: [{ id: "event-1", text: "Ready" }] },
    ]);
    const unsubscribe = source.subscribe("workspace-1", listener);
    await vi.advanceTimersByTimeAsync(1800);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    vi.useRealTimers();
  });

  it("labels recoverable sessions honestly", () => {
    expect(statusLabel("recoverable")).toBe("Recoverable");
  });

  it("uses the configured default access for a new run", () => {
    render(
      <AgentWorkspace
        state={state([])}
        onChange={() => undefined}
        sessionSource={unavailableAgentSessionSource}
        defaultSandbox="workspace_write"
      />,
    );

    expect(screen.getByLabelText("Access")).toHaveValue("workspace_write");
  });

  it("applies normalized events without treating provider text as a raw log", () => {
    const initial = state([session({ state: "running" })]);
    const next = agentReducer(initial, {
      type: "session/event",
      id: "agent-1",
      event: {
        id: "event-1",
        sessionId: "agent-1",
        occurredAt: "2026-08-02T10:00:00Z",
        type: "lifecycle",
        state: "waiting",
        summary: "Waiting for approval",
      },
    });
    expect(next.sessions[0]?.state).toBe("waiting");
    expect(next.sessions[0]?.events).toHaveLength(1);
  });

  it("keeps the default runtime honest until an IPC source is connected", async () => {
    expect(unavailableAgentSessionSource.availability.status).toBe(
      "unavailable",
    );
    await expect(
      unavailableAgentSessionSource.list("workspace-1"),
    ).resolves.toEqual([]);
    await expect(
      unavailableAgentSessionSource.cancel("workspace-1", "agent-1"),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "agent.runtime_unavailable" },
    });
  });
});

function success<T>(data: T) {
  return {
    contract: "ipc_result" as const,
    version: 1 as const,
    ok: true as const,
    data,
    correlationId: "test-correlation",
  };
}
