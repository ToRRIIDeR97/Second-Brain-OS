import { describe, expect, test } from "bun:test"
import { Effect, Exit, Scope } from "effect"
import { HarnessAskUser } from "@opencode-ai/core/harness/ask-user"
import { HarnessDelegation } from "@opencode-ai/core/harness/delegation"
import { QuestionV2 } from "@opencode-ai/core/question"
import { SessionV2 } from "@opencode-ai/core/session"

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

const parent = { sessionID: "ses_parent" }
const call = (name: string, args: Record<string, unknown>, caller: HarnessDelegation.Caller = parent) =>
  HarnessDelegation.handleMessage(
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } },
    caller,
    handler,
  )
const toolNames = (answer: unknown) =>
  (answer as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name)
const text = (answer: unknown) => (answer as { result: { content: { text: string }[] } }).result.content[0].text

// A fake asker: answers with `next` and records what it was asked.
const asked: Array<{ readonly questions: ReadonlyArray<QuestionV2.Prompt>; readonly waitSeconds: number }> = []
const asking = (next: HarnessAskUser.Outcome): HarnessDelegation.Caller => ({
  sessionID: "ses_parent",
  ask: async (questions, waitSeconds) => {
    asked.push({ questions, waitSeconds })
    return next
  },
})
const question = {
  question: "Ship it?",
  header: "Ship",
  options: [
    { label: "Yes", description: "Merge now" },
    { label: "No", description: "Wait" },
  ],
}

describe("harness delegation MCP protocol", () => {
  test("negotiates a supported protocol version and lists the tools", async () => {
    const init = await HarnessDelegation.handleMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      parent,
      handler,
    )
    expect(init).toMatchObject({ id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } } })
    const unknown = await HarnessDelegation.handleMessage(
      { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      parent,
      handler,
    )
    expect(unknown).toMatchObject({ result: { protocolVersion: "2025-06-18" } })
    const tools = await HarnessDelegation.handleMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      parent,
      handler,
    )
    expect(toolNames(tools)).toEqual(["list_agents", "delegate_task", "task_result", "cancel_task"])
  })

  test("ignores notifications and rejects unknown methods", async () => {
    expect(
      await HarnessDelegation.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, parent, handler),
    ).toBeUndefined()
    expect(
      await HarnessDelegation.handleMessage({ jsonrpc: "2.0", id: 4, method: "resources/list" }, parent, handler),
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
    expect(JSON.parse(text(answer))).toMatchObject({
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

  test("offers ask_user to a runtime that can ask, and the delegation tools only with a handler", async () => {
    const list = (caller: HarnessDelegation.Caller, current?: HarnessDelegation.Handler) =>
      HarnessDelegation.handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/list" }, caller, current).then(toolNames)
    expect(await list(asking({ type: "open" }), handler)).toEqual([
      "ask_user",
      "list_agents",
      "delegate_task",
      "task_result",
      "cancel_task",
    ])
    expect(await list(asking({ type: "open" }))).toEqual(["ask_user"])
    const disabled = await HarnessDelegation.handleMessage(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "list_agents", arguments: {} } },
      asking({ type: "open" }),
      undefined,
    )
    expect(disabled).toMatchObject({ result: { isError: true } })
    expect(text(disabled)).toContain("delegation is turned off")
  })

  test("ask_user waits on the asker and answers in the native question tool's wording", async () => {
    asked.length = 0
    const answered = await call("ask_user", { questions: [question] }, asking({ type: "answered", answers: [["Yes"]] }))
    expect(asked).toEqual([{ questions: [question], waitSeconds: HarnessAskUser.WAIT_SECONDS }])
    expect(answered).toMatchObject({ result: { isError: false } })
    expect(text(answered)).toBe(
      'User has answered your questions: "Ship it?"="Yes". You can now continue with the user\'s answers in mind.',
    )
    expect(text(await call("ask_user", { questions: [question] }, asking({ type: "declined" })))).toContain(
      "declined to answer",
    )
    const open = await call("ask_user", { questions: [question] }, asking({ type: "open" }))
    expect(open).toMatchObject({ result: { isError: false } })
    expect(text(open)).toContain("Call ask_user again with the same questions")
  })

  test("ask_user rejects malformed questions and runtimes that cannot ask", async () => {
    asked.length = 0
    for (const args of [{}, { questions: [] }, { questions: [{ question: "Ship it?" }] }])
      expect(await call("ask_user", args, asking({ type: "open" }))).toMatchObject({ result: { isError: true } })
    expect(asked).toEqual([])
    expect(text(await call("ask_user", { questions: [question] }))).toBe("ask_user is not available for this agent.")
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

const sessionID = SessionV2.ID.make("ses_parent")

describe("harness delegation endpoint", () => {
  test("offers no endpoint until a handler is installed", async () => {
    const value = await Effect.runPromise(Effect.scoped(HarnessDelegation.endpoint(sessionID)))
    expect(value).toBeUndefined()
  })

  test("offers ask_user over loopback without a delegation handler", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const value = yield* HarnessDelegation.endpoint(sessionID, asking({ type: "open" }).ask)
          const response = yield* Effect.promise(() =>
            fetch(value!.url, {
              method: "POST",
              headers: { Authorization: `Bearer ${value!.token}` },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
            }).then((item) => item.json()),
          )
          expect(toolNames(response)).toEqual(["ask_user"])
        }),
      ),
    )
  })

  test("serves MCP over loopback for a runtime's token until its scope closes", async () => {
    const uninstall = HarnessDelegation.install(handler)
    const scope = Scope.makeUnsafe()
    try {
      const value = await Effect.runPromise(HarnessDelegation.endpoint(sessionID).pipe(Scope.provide(scope)))
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
