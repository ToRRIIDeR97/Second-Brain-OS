// Deterministic ACP agent for the harness settings tests. Scenario: argv[2], else "models".
//   models          session/new returns the legacy `models` field; switching uses session/set_model.
//   config-options  session/new returns only `configOptions`; session/set_model is not supported.
//   no-models       session/new returns neither field.
//   not-acp         prints a non-JSON line and exits.
// Every prompt replies with the text `model:<current model>`.
// Every received message is appended as one JSON line to FAKE_ACP_LOG when it is set.
import { appendFileSync } from "node:fs"

const scenario = process.argv[2] ?? "models"
const log = process.env.FAKE_ACP_LOG

if (scenario === "not-acp") {
  process.stdout.write("hello, this is not json\n")
  process.exit(0)
}

let current = "fake-a"
let sessionCounter = 0

const write = (message: unknown) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...(message as object) })}\n`)
const respond = (id: unknown, result: unknown) => write({ id, result })
const fail = (id: unknown, code: number, message: string) => write({ id, error: { code, message } })

const legacyModels = () => ({
  currentModelId: current,
  availableModels: [
    { modelId: "fake-a", name: "Fake A" },
    { modelId: "fake-b", name: "Fake B", description: "Second" },
  ],
})

const configOptions = () => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: current,
    options: [
      { value: "fake-a", name: "Fake A" },
      { value: "fake-b", name: "Fake B" },
    ],
  },
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: "build",
    options: [{ value: "build", name: "Build" }],
  },
]

const sessionResult = () => {
  if (scenario === "config-options") return { configOptions: configOptions() }
  if (scenario === "no-models") return {}
  return { models: legacyModels() }
}

function handle(message: any) {
  if (log) appendFileSync(log, `${JSON.stringify(message)}\n`)
  const { id, method, params } = message
  if (method === "initialize")
    return respond(id, {
      protocolVersion: 1,
      agentInfo: { name: "fake-acp", title: "Fake ACP", version: "9.9.9" },
      agentCapabilities: { loadSession: false },
      authMethods: [],
    })
  if (method === "session/new") {
    sessionCounter += 1
    return respond(id, { sessionId: `s${sessionCounter}`, ...sessionResult() })
  }
  if (method === "session/set_model") {
    if (scenario === "config-options") return fail(id, -32601, "Method not found")
    current = params.modelId
    return respond(id, {})
  }
  if (method === "session/set_config_option") {
    if (scenario !== "config-options" || params.configId !== "model") return fail(id, -32602, "Unknown option")
    current = params.value
    return respond(id, { configOptions: configOptions() })
  }
  if (method === "session/prompt") {
    write({
      method: "session/update",
      params: {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `model:${current}` },
        },
      },
    })
    return respond(id, { stopReason: "end_turn" })
  }
  if (method === "session/cancel") return
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
    if (line) handle(JSON.parse(line))
    index = buffer.indexOf("\n")
  }
})
process.stdin.on("end", () => process.exit(0))
