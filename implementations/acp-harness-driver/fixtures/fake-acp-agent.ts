// Deterministic ACP agent for tests. Scenario: argv[2], else FAKE_ACP_SCENARIO, else "basic".
// Every received message is appended as one JSON line to FAKE_ACP_LOG when it is set.
import { appendFileSync } from "node:fs"

const scenario = process.argv[2] ?? process.env.FAKE_ACP_SCENARIO ?? "basic"
const log = process.env.FAKE_ACP_LOG
const stop = process.env.FAKE_ACP_STOP ?? "end_turn"

if (scenario === "not-acp") {
  process.stdout.write("hello, this is not json\n")
  process.exit(0)
}
if (scenario === "exit") process.exit(1)

let nextID = 1000
const waiting = new Map<number, (message: any) => void>()
let sessionCounter = 0
let pendingPrompt: { id: number; sessionId: string } | undefined

const write = (message: unknown) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...(message as object) })}\n`)
const respond = (id: unknown, result: unknown) => write({ id, result })
const fail = (id: unknown, code: number, message: string) => write({ id, error: { code, message } })
const update = (sessionId: string, value: unknown) =>
  write({ method: "session/update", params: { sessionId, update: value } })
const chunk = (sessionId: string, kind: string, text: string, messageId?: string) =>
  update(sessionId, { sessionUpdate: kind, content: { type: "text", text }, ...(messageId ? { messageId } : {}) })
const request = (method: string, params: unknown) =>
  new Promise<any>((resolve) => {
    const id = nextID++
    waiting.set(id, resolve)
    write({ id, method, params })
  })

const models = {
  currentModelId: "fake-a",
  availableModels: [
    { modelId: "fake-a", name: "Fake A" },
    { modelId: "fake-b", name: "Fake B", description: "Second" },
  ],
}

async function prompt(id: unknown, params: any) {
  const sessionId = params.sessionId
  const text = (params.prompt ?? []).map((block: any) => block.text ?? "").join("")
  if (scenario === "prompt-error") return fail(id, -32000, "boom")
  if (scenario === "slow") {
    pendingPrompt = { id: id as number, sessionId }
    chunk(sessionId, "agent_message_chunk", "working")
    return
  }
  if (scenario === "burst") {
    // All updates and the response leave in one write so they arrive in one chunk.
    const lines = Array.from({ length: 200 }, (_, index) =>
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `${index},` } },
        },
      }),
    )
    lines.push(JSON.stringify({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } }))
    process.stdout.write(`${lines.join("\n")}\n`)
    return
  }
  if (scenario === "permission") {
    const result = await request("session/request_permission", {
      sessionId,
      toolCall: { toolCallId: "t2", title: "rm -rf build", kind: "execute", rawInput: { command: "rm -rf build" } },
      options: [
        { optionId: "a1", name: "Allow once", kind: "allow_once" },
        { optionId: "a2", name: "Always allow", kind: "allow_always" },
        { optionId: "r1", name: "Reject", kind: "reject_once" },
      ],
    })
    chunk(sessionId, "agent_message_chunk", `outcome:${JSON.stringify(result.result?.outcome ?? result.error)}`)
    return respond(id, { stopReason: "end_turn" })
  }
  if (scenario === "permission-allow-always-only" || scenario === "permission-no-reject") {
    const options =
      scenario === "permission-allow-always-only"
        ? [
            { optionId: "aa", name: "Always", kind: "allow_always" },
            { optionId: "rr", name: "Reject always", kind: "reject_always" },
          ]
        : [{ optionId: "a1", name: "Allow once", kind: "allow_once" }]
    const result = await request("session/request_permission", {
      sessionId,
      toolCall: { toolCallId: "t3", title: "Fetch page", kind: "fetch", rawInput: { url: "https://example.com" } },
      options,
    })
    chunk(sessionId, "agent_message_chunk", `outcome:${JSON.stringify(result.result?.outcome ?? result.error)}`)
    return respond(id, { stopReason: "end_turn" })
  }
  if (scenario === "fs-probe") {
    const read = await request("fs/read_text_file", { sessionId, path: "/etc/hosts" })
    const term = await request("terminal/create", { sessionId, command: "ls" })
    chunk(sessionId, "agent_message_chunk", `fs:${read.error?.code};terminal:${term.error?.code}`)
    return respond(id, { stopReason: "end_turn" })
  }
  if (scenario === "load") {
    chunk(sessionId, "agent_message_chunk", "fresh")
    return respond(id, { stopReason: "end_turn" })
  }
  // basic and the remaining scenarios
  chunk(sessionId, "agent_thought_chunk", "thinking")
  chunk(sessionId, "agent_message_chunk", "Hello ")
  update(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "Run ls",
    kind: "execute",
    status: "pending",
    rawInput: { command: "ls" },
  })
  update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" })
  update(sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "file.txt" } }],
  })
  chunk(sessionId, "agent_message_chunk", `world:${text}`)
  respond(id, {
    stopReason: stop,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedReadTokens: 2, thoughtTokens: 1 },
  })
}

async function handle(message: any) {
  if (log) appendFileSync(log, `${JSON.stringify(message)}\n`)
  if (message.id !== undefined && message.method === undefined) {
    waiting.get(message.id)?.(message)
    waiting.delete(message.id)
    return
  }
  const { id, method, params } = message
  if (method === "initialize") {
    if (scenario === "silent") return
    const loadSession = scenario === "load" || scenario === "load-fails"
    return respond(id, {
      protocolVersion: 1,
      agentInfo: { name: "fake-acp", title: "Fake ACP", version: "9.9.9" },
      agentCapabilities: { loadSession },
      authMethods: [],
    })
  }
  if (method === "session/new") {
    sessionCounter += 1
    return respond(id, { sessionId: `s${sessionCounter}`, models })
  }
  if (method === "session/load") {
    if (scenario === "load-fails") return fail(id, -32002, "Session not found")
    chunk(params.sessionId, "user_message_chunk", "old question")
    chunk(params.sessionId, "agent_message_chunk", "OLD")
    return respond(id, { models })
  }
  if (method === "session/set_model") {
    if (scenario === "set-model-fails") return fail(id, -32601, "Method not found")
    return respond(id, {})
  }
  if (method === "session/prompt") return prompt(id, params)
  if (method === "session/cancel") {
    if (pendingPrompt) {
      respond(pendingPrompt.id, { stopReason: "cancelled" })
      pendingPrompt = undefined
    }
    return
  }
  if (id !== undefined) fail(id, -32601, `Method not found: ${method}`)
}

let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (data: string) => {
  buffer += data
  let index = buffer.indexOf("\n")
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) void handle(JSON.parse(line))
    index = buffer.indexOf("\n")
  }
})
process.stdin.on("end", () => process.exit(0))
