import { createMockIpc } from "../src/lib/ipc/mock";

test("validates typed command envelopes and records correlation IDs", async () => {
  const mock = createMockIpc();
  const result = await mock.client.system.ping();
  expect(result).toEqual({
    contract: "ipc_result",
    version: 1,
    ok: true,
    data: "pong",
    correlationId: "mock-correlation",
  });
  expect(mock.calls[0]?.command).toBe("system_ping");
});

test("git diff uses a workspace-scoped, typed read-only request", async () => {
  const mock = createMockIpc();
  const result = await mock.client.git.diff("workspace-1", true, [
    "src/app.ts",
  ]);
  expect(result).toMatchObject({
    ok: true,
    data: { staged: true, patch: "", truncated: false },
  });
  expect(mock.calls[0]).toEqual({
    command: "git_diff",
    args: {
      workspaceId: "workspace-1",
      staged: true,
      paths: ["src/app.ts"],
    },
  });
});

test("stream subscriptions return an unsubscribe function", async () => {
  const mock = createMockIpc();
  const seen: string[] = [];
  const unsubscribe = await mock.events.subscribe<{ message: string }>(
    "job.progress",
    (event) => seen.push(event.data.message),
  );
  expect(mock.listenerCount("job.progress")).toBe(1);
  mock.emit("job.progress", {
    schemaVersion: 1,
    event: "job.progress",
    correlationId: "c-1",
    data: { message: "halfway" },
  });
  expect(seen).toEqual(["halfway"]);
  unsubscribe();
  expect(mock.listenerCount("job.progress")).toBe(0);
});

test("malformed command responses become stable typed errors", async () => {
  const mock = createMockIpc();
  mock.setResponse("system_ping", {
    contract: "ipc_result",
    version: 1,
    ok: true,
    correlationId: "bad",
  });
  const result = await mock.client.system.ping();
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("IPC_MALFORMED_ENVELOPE");
});

test("Project commands keep Brain identity and location grants typed", async () => {
  const mock = createMockIpc();
  await mock.client.projects.create({
    brainWorkspaceId: "ws_brain",
    name: "Control center",
    outcome: "Make the next action obvious.",
    instructions: "Keep writes reviewable.",
    tags: ["desktop"],
    location: {
      mode: "rootSelection",
      grantId: "root_grant_01",
      trustLevel: "trusted",
    },
  });
  expect(mock.calls[0]).toEqual({
    command: "project_create",
    args: {
      request: {
        brainWorkspaceId: "ws_brain",
        name: "Control center",
        outcome: "Make the next action obvious.",
        instructions: "Keep writes reviewable.",
        tags: ["desktop"],
        location: {
          mode: "rootSelection",
          grantId: "root_grant_01",
          trustLevel: "trusted",
        },
      },
    },
  });
});

test("workspace registration carries only a short-lived native root grant", async () => {
  const mock = createMockIpc();
  await mock.client.workspaces.selectRoot();
  await mock.client.workspaces.register({
    name: "Brain",
    rootPath: "C:\\Users\\test\\Brain",
    rootGrantId: "root_grant_01",
    kind: "brain",
    trustLevel: "trusted",
  });

  expect(mock.calls).toEqual([
    { command: "workspace_select_root" },
    {
      command: "workspace_register",
      args: {
        registration: {
          name: "Brain",
          rootPath: "C:\\Users\\test\\Brain",
          rootGrantId: "root_grant_01",
          kind: "brain",
          trustLevel: "trusted",
        },
      },
    },
  ]);
});

test("managed agent commands preserve workspace, sandbox, and approval scope", async () => {
  const mock = createMockIpc();
  await mock.client.agents.probe();
  await mock.client.agents.list("ws_brain");
  await mock.client.agents.start({
    workspaceId: "ws_brain",
    objective: "Review the active project",
    sandbox: "read_only",
  });
  await mock.client.agents.message({
    workspaceId: "ws_brain",
    sessionId: "agent_01",
    message: "Summarize the risks",
  });
  await mock.client.agents.cancel({
    workspaceId: "ws_brain",
    sessionId: "agent_01",
  });
  await mock.client.agents.decideApproval({
    workspaceId: "ws_brain",
    sessionId: "agent_01",
    approvalId: "approval_01",
    decision: "denied",
  });

  expect(mock.calls).toEqual([
    { command: "agent_provider_probe" },
    { command: "agent_session_list", args: { workspaceId: "ws_brain" } },
    {
      command: "agent_session_start",
      args: {
        request: {
          workspaceId: "ws_brain",
          objective: "Review the active project",
          sandbox: "read_only",
        },
      },
    },
    {
      command: "agent_session_message",
      args: {
        request: {
          workspaceId: "ws_brain",
          sessionId: "agent_01",
          message: "Summarize the risks",
        },
      },
    },
    {
      command: "agent_session_cancel",
      args: {
        request: { workspaceId: "ws_brain", sessionId: "agent_01" },
      },
    },
    {
      command: "agent_approval_decide",
      args: {
        request: {
          workspaceId: "ws_brain",
          sessionId: "agent_01",
          approvalId: "approval_01",
          decision: "denied",
        },
      },
    },
  ]);
});

test("planner commands preserve Brain, item, and schedule identity", async () => {
  const mock = createMockIpc();
  await mock.client.planner.list({ brainWorkspaceId: "ws_brain" });
  await mock.client.planner.create({
    brainWorkspaceId: "ws_brain",
    draft: {
      kind: "calendar",
      title: "Review",
      schedule: {
        kind: "exact",
        startEpochSeconds: 100,
        endEpochSeconds: 200,
        timezone: "Asia/Singapore",
      },
    },
  });
  await mock.client.planner.update("ws_brain", "planner_01", {
    clearSchedule: true,
  });

  expect(mock.calls).toEqual([
    {
      command: "planner_list",
      args: { request: { brainWorkspaceId: "ws_brain" } },
    },
    {
      command: "planner_create",
      args: {
        request: {
          brainWorkspaceId: "ws_brain",
          draft: {
            kind: "calendar",
            title: "Review",
            schedule: {
              kind: "exact",
              startEpochSeconds: 100,
              endEpochSeconds: 200,
              timezone: "Asia/Singapore",
            },
          },
        },
      },
    },
    {
      command: "planner_update",
      args: {
        request: {
          brainWorkspaceId: "ws_brain",
          itemId: "planner_01",
          patch: { clearSchedule: true },
        },
      },
    },
  ]);
});
