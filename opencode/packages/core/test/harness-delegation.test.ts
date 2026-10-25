import { describe, expect, test } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { HarnessDelegation } from "@opencode-ai/core/harness/delegation"

const calls: Array<{ readonly sessionID: string; readonly input: HarnessDelegation.DelegateInput }> = []
const handler: HarnessDelegation.Handler = {
  listAgents: async () => [{ id: "codex", name: "Codex", status: "available", current: false, models: [] }],
  delegate: async (sessionID, input) => {
    calls.push({ sessionID, input })
    return { taskID: "ses_child", agent: input.agent, status: "completed", output: `done: ${input.task}` }
  },
  result: async (_sessionID, taskID) => ({ taskID, agent: "codex", status: "running" }),
  cancel: async () => Promise.reject(new Error("No delegated task ses_x belongs to this thread.")),
}

const call = (name: string, args: Record<string, unknown>) =>
  HarnessDelegation.handleMessage(
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } },
    "ses_parent",
    handler,
  )

describe("harness delegation MCP protocol", () => {
  test("negotiates a supported protocol version and lists the tools", async () => {
    const init = await HarnessDelegation.handleMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      "ses_parent",
      handler,
    )
    expect(init).toMatchObject({ id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } } })
    const unknown = await HarnessDelegation.handleMessage(
      { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      "ses_parent",
      handler,
    )
    expect(unknown).toMatchObject({ result: { protocolVersion: "2025-06-18" } })
    const tools = await HarnessDelegation.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, "s", handler)
    expect((tools as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name)).toEqual([
      "list_agents",
      "delegate_task",
      "task_result",
      "cancel_task",
    ])
  })

  test("ignores notifications and rejects unknown methods", async () => {
    expect(
      await HarnessDelegation.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, "s", handler),
    ).toBeUndefined()
    expect(
      await HarnessDelegation.handleMessage({ jsonrpc: "2.0", id: 4, method: "resources/list" }, "s", handler),
    ).toMatchObject({ error: { code: -32601 } })
  })

  test("passes the calling Run and clamped wait to delegate_task", async () => {
    calls.length = 0
    const answer = await call("delegate_task", { agent: "codex", task: " Click the button ", wait_seconds: 99_999 })
    expect(calls).toEqual([
      {
        sessionID: "ses_parent",
        input: {
          agent: "codex",
          task: "Click the button",
          model: undefined,
          reasoningEffort: undefined,
          title: undefined,
          waitSeconds: HarnessDelegation.MAX_WAIT_SECONDS,
        },
      },
    ])
    expect(answer).toMatchObject({ result: { isError: false } })
    expect(JSON.parse((answer as { result: { content: { text: string }[] } }).result.content[0]!.text)).toMatchObject({
      status: "completed",
      output: "done: Click the button",
    })
  })

  test("reports missing arguments and handler failures as tool errors", async () => {
    expect(await call("delegate_task", { agent: "codex" })).toMatchObject({
      result: { isError: true, content: [{ text: "delegate_task needs an agent and a task." }] },
    })
    expect(await call("cancel_task", { task_id: "ses_x" })).toMatchObject({
      result: { isError: true, content: [{ text: "No delegated task ses_x belongs to this thread." }] },
    })
  })

  test("registers the endpoint with Codex through config overrides and an env token", () => {
    expect(HarnessDelegation.codexArgs({ url: "http://127.0.0.1:1/mcp", token: "secret" })).toEqual([
      "-c",
      'mcp_servers.tenon.url="http://127.0.0.1:1/mcp"',
      "-c",
      'mcp_servers.tenon.bearer_token_env_var="TENON_DELEGATION_TOKEN"',
      "-c",
      `mcp_servers.tenon.tool_timeout_sec=${HarnessDelegation.MAX_WAIT_SECONDS + 60}`,
    ])
  })
})

describe("harness delegation endpoint", () => {
  test("offers no endpoint until a handler is installed", async () => {
    const value = await Effect.runPromise(Effect.scoped(HarnessDelegation.endpoint("ses_parent")))
    expect(value).toBeUndefined()
  })

  test("serves MCP over loopback for a runtime's token until its scope closes", async () => {
    const uninstall = HarnessDelegation.install(handler)
    const scope = Scope.makeUnsafe()
    try {
      const value = await Effect.runPromise(HarnessDelegation.endpoint("ses_parent").pipe(Scope.provide(scope)))
      expect(value?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
      const post = (token: string, headers: Record<string, string> = {}) =>
        fetch(value!.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_agents" } }),
        })

      const ok = await post(value!.token)
      expect(ok.status).toBe(200)
      expect(await ok.json()).toMatchObject({ id: 1, result: { isError: false } })
      expect((await post("wrong")).status).toBe(401)
      expect((await post(value!.token, { Origin: "https://example.com" })).status).toBe(403)
      const notification = await fetch(value!.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${value!.token}` },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      })
      expect(notification.status).toBe(202)

      await Effect.runPromise(Scope.close(scope, Exit.void))
      expect((await post(value!.token)).status).toBe(401)
    } finally {
      uninstall()
    }
  })
})
