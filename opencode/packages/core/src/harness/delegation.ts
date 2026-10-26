export * as HarnessDelegation from "./delegation"

import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { Effect, Option, Schema } from "effect"
import { QuestionV2 } from "../question"
import { SessionSchema } from "../session/schema"
import { HarnessAskUser } from "./ask-user"

/**
 * The `tenon` MCP server for external harnesses (Claude Code and Gemini over ACP, Codex). Each
 * harness runtime gets its own bearer token, bound to the Run that owns the runtime, so a tool
 * call always knows which Run is calling.
 *
 * It serves two things. `ask_user` puts the harness's questions in the Run's question dock; every
 * runtime with a Run gets it. Cross-harness delegation hands a task to an agent in another
 * harness; its task work is installed by the server (`delegation-tasks.ts`), which owns sessions,
 * and without it the delegation tools are not offered. This module only holds the endpoint and protocol.
 *
 * The listener and tokens are process-global on purpose: harness runtimes are built per Location,
 * while the endpoint is one loopback port for the whole server process.
 */

export const SERVER_NAME = "tenon"
export const TOKEN_ENV = "TENON_DELEGATION_TOKEN"
/** Codex and other MCP clients time out tool calls; a delegated run waits at most this long per call. */
export const MAX_WAIT_SECONDS = 600
export const DEFAULT_WAIT_SECONDS = 300
const BODY_LIMIT = 1_000_000
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]

export interface Agent {
  readonly id: string
  readonly name: string
  readonly status: "available" | "unavailable"
  readonly current: boolean
  readonly models: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly isDefault: boolean
    readonly reasoningEfforts: ReadonlyArray<string>
  }>
}

export interface DelegateInput {
  readonly agent: string
  readonly task: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly title?: string
  readonly waitSeconds: number
}

export interface TaskResult {
  readonly taskID: string
  readonly agent: string
  readonly status: "running" | "completed" | "failed" | "cancelled"
  readonly output?: string
  readonly error?: string
}

/** Task operations, called with the ID of the Run whose harness made the call. */
export interface Handler {
  readonly listAgents: (sessionID: string) => Promise<ReadonlyArray<Agent>>
  readonly delegate: (sessionID: string, input: DelegateInput) => Promise<TaskResult>
  readonly result: (sessionID: string, taskID: string, waitSeconds: number) => Promise<TaskResult>
  readonly cancel: (sessionID: string, taskID: string) => Promise<TaskResult>
}

export interface Endpoint {
  readonly url: string
  readonly token: string
}

/** The Run a token belongs to, and its runtime's asker when the runtime can ask the user. */
export interface Caller {
  readonly sessionID: string
  readonly ask?: HarnessAskUser.Ask
}

const state: {
  handler?: Handler
  tokens: Map<string, Caller>
  listener?: Promise<{ server: Server; url: string }>
} = { tokens: new Map() }

/** Installs the task handler; the returned function removes it again if it is still the current one. */
export function install(handler: Handler) {
  state.handler = handler
  return () => {
    if (state.handler === handler) state.handler = undefined
  }
}

/**
 * A token for one harness runtime of `sessionID`, revoked when the scope closes; closing it also
 * withdraws a question the runtime left open. With neither `questions` nor an installed delegation
 * handler (tests, the headless CLI) there is nothing to offer, so the harness gets none.
 */
export const endpoint = (sessionID: SessionSchema.ID, questions?: QuestionV2.Interface) =>
  Effect.gen(function* () {
    const ask = questions ? yield* HarnessAskUser.make(questions, sessionID) : undefined
    return yield* Effect.acquireRelease(
      Effect.promise(async (): Promise<Endpoint | undefined> => {
        if (!state.handler && !ask) return undefined
        const listener = await listen().catch(() => undefined)
        if (!listener) return undefined
        const token = randomBytes(32).toString("base64url")
        state.tokens.set(token, { sessionID, ask })
        return { url: listener.url, token }
      }),
      (value) =>
        Effect.sync(() => {
          if (value) state.tokens.delete(value.token)
        }),
    )
  })

/** Codex `-c` overrides that register the endpoint; the token itself travels in `TOKEN_ENV`. */
export function codexArgs(value: Endpoint) {
  return [
    "-c",
    `mcp_servers.${SERVER_NAME}.url=${JSON.stringify(value.url)}`,
    "-c",
    `mcp_servers.${SERVER_NAME}.bearer_token_env_var=${JSON.stringify(TOKEN_ENV)}`,
    "-c",
    `mcp_servers.${SERVER_NAME}.tool_timeout_sec=${MAX_WAIT_SECONDS + 60}`,
  ]
}

/** The ACP `session/new` entry; only agents that advertise `mcpCapabilities.http` accept it. */
export function acpServer(value: Endpoint) {
  return {
    type: "http" as const,
    name: SERVER_NAME,
    url: value.url,
    headers: [{ name: "Authorization", value: `Bearer ${value.token}` }],
  }
}

export const ASK_USER_TOOL = {
  name: "ask_user",
  description:
    'Ask the user one or more questions in Tenon Workbench and wait for the answers. Use it to clarify ambiguous instructions, get preferences or decisions, or offer choices about what direction to take. Each question is shown with its options; the user can also type their own answer, so do not add an "Other" option. If you recommend an option, list it first and add "(Recommended)" to its label. If the user has not answered within a few minutes, the result says the question is still open: call ask_user again with the same questions to keep waiting.',
  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        description: "Questions to ask",
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "Complete question" },
            header: { type: "string", description: "Very short label (max 30 chars)" },
            options: {
              type: "array",
              description: "Available choices",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "Display text (1-5 words, concise)" },
                  description: { type: "string", description: "Explanation of choice" },
                },
                required: ["label", "description"],
                additionalProperties: false,
              },
            },
            multiple: { type: "boolean", description: "Allow selecting multiple choices" },
          },
          required: ["question", "header", "options"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
} as const

/** The delegation tools, offered only while a delegation handler is installed. */
export const TOOLS = [
  {
    name: "list_agents",
    description:
      "List the agent harnesses this workbench can delegate to (for example Codex or Claude Code), with their models and reasoning efforts. The agent marked current is the one you are running in.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "delegate_task",
    description:
      "Hand a self-contained task to an agent in another harness, for example a model that is better at computer use or a different coding style. The agent runs as a child thread in the same folder, with its own tools and approvals, and does not see this conversation: describe the goal, the relevant files and what to report back. Waits up to wait_seconds for the result; if the task is still running, returns its task_id for task_result.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Agent ID from list_agents." },
        task: { type: "string", description: "Complete instructions for the delegated agent." },
        model: { type: "string", description: "Model ID from list_agents. Omit for the agent's default." },
        reasoning_effort: { type: "string", description: "One of the model's reasoning efforts." },
        title: { type: "string", description: "Short title for the child thread." },
        wait_seconds: {
          type: "integer",
          minimum: 0,
          maximum: MAX_WAIT_SECONDS,
          description: `How long to wait for the result (default ${DEFAULT_WAIT_SECONDS}).`,
        },
      },
      required: ["agent", "task"],
      additionalProperties: false,
    },
  },
  {
    name: "task_result",
    description: "Get the result of a delegated task, waiting up to wait_seconds while it is still running.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        wait_seconds: { type: "integer", minimum: 0, maximum: MAX_WAIT_SECONDS },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_task",
    description: "Stop a delegated task that is still running.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
] as const

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

/** Answers one MCP JSON-RPC message from `caller`; notifications get no answer. */
export async function handleMessage(message: Message, caller: Caller, handler: Handler | undefined) {
  if (typeof message.method !== "string") return error(message.id ?? null, -32600, "Invalid request")
  if (message.id === undefined || message.id === null) return undefined
  const params = isRecord(message.params) ? message.params : {}
  if (message.method === "initialize") {
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : undefined
    return reply(message.id, {
      protocolVersion: requested && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: "tenon-workbench", version: "0.1.0" },
      instructions: [
        ...(caller.ask ? ["Use ask_user to ask the user questions in Tenon Workbench."] : []),
        ...(handler
          ? [
              "Use the task tools to delegate a task to an agent in another harness and collect its result. Call list_agents first.",
            ]
          : []),
      ].join(" "),
    })
  }
  if (message.method === "ping") return reply(message.id, {})
  if (message.method === "tools/list")
    return reply(message.id, { tools: [...(caller.ask ? [ASK_USER_TOOL] : []), ...(handler ? TOOLS : [])] })
  if (message.method !== "tools/call") return error(message.id, -32601, "Method not found")
  const name = String(params.name)
  const args = isRecord(params.arguments) ? params.arguments : {}
  const result = await (
    name === ASK_USER_TOOL.name
      ? askUser(args, caller)
      : handler
        ? callTool(name, args, caller.sessionID, handler)
        : Promise.reject(new Error(`${name} is not available: delegation is turned off in this app process.`))
  ).then(
    (value) => ({
      content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
      isError: false,
    }),
    (cause) => ({
      content: [{ type: "text", text: cause instanceof Error ? cause.message : String(cause) }],
      isError: true,
    }),
  )
  return reply(message.id, result)
}

/** Runs one delegation tool for the in-process loop, which calls it natively instead of over MCP. */
export function invoke(name: string, args: Record<string, unknown>, sessionID: string) {
  if (!state.handler) return Promise.reject(new Error("Delegation is not available in this app process."))
  return callTool(name, args, sessionID, state.handler)
}

async function askUser(args: Record<string, unknown>, caller: Caller) {
  if (!caller.ask) throw new Error("ask_user is not available for this agent.")
  const questions = Option.getOrUndefined(Schema.decodeUnknownOption(HarnessAskUser.Input)(args))?.questions
  if (!questions?.length)
    throw new Error("ask_user needs questions: [{ question, header, options: [{ label, description }], multiple? }].")
  return HarnessAskUser.resultText(questions, await caller.ask(questions, HarnessAskUser.WAIT_SECONDS))
}

function callTool(name: string, args: Record<string, unknown>, sessionID: string, handler: Handler): Promise<unknown> {
  const wait = waitSeconds(args.wait_seconds)
  if (name === "list_agents") return handler.listAgents(sessionID)
  if (name === "delegate_task") {
    const agent = text(args.agent)
    const task = text(args.task)
    if (!agent || !task) return Promise.reject(new Error("delegate_task needs an agent and a task."))
    return handler.delegate(sessionID, {
      agent,
      task,
      model: text(args.model),
      reasoningEffort: text(args.reasoning_effort),
      title: text(args.title),
      waitSeconds: wait,
    })
  }
  const taskID = text(args.task_id)
  if (!taskID) return Promise.reject(new Error(`${name} needs a task_id.`))
  if (name === "task_result") return handler.result(sessionID, taskID, wait)
  if (name === "cancel_task") return handler.cancel(sessionID, taskID)
  return Promise.reject(new Error(`Unknown tool: ${name}`))
}

function listen() {
  state.listener ??= new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      void serve(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500)
        response.end()
      })
    })
    server.once("error", (cause) => {
      state.listener = undefined
      reject(cause)
    })
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("Delegation endpoint has no port."))
      // The server process must be able to exit while the endpoint idles.
      server.unref()
      resolve({ server, url: `http://127.0.0.1:${address.port}/mcp` })
    })
  })
  return state.listener
}

async function serve(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  if (url.pathname !== "/mcp") return void response.writeHead(404).end()
  // A browser page could reach a loopback port; MCP clients send no Origin, so any Origin is refused.
  if (request.headers.origin) return void response.writeHead(403).end()
  const caller = authorize(request.headers.authorization)
  if (!caller) return void response.writeHead(401, { "WWW-Authenticate": "Bearer" }).end()
  if (request.method !== "POST") return void response.writeHead(405, { Allow: "POST" }).end()
  const handler = state.handler
  if (!handler && !caller.ask) return void response.writeHead(503).end()
  const body = await readBody(request)
  if (body === undefined) return void response.writeHead(413).end()
  const parsed = parse(body)
  if (!parsed) return json(response, error(null, -32700, "Parse error"))
  const messages = Array.isArray(parsed) ? parsed : [parsed]
  const answers = (
    await Promise.all(messages.map((message) => handleMessage(isRecord(message) ? message : {}, caller, handler)))
  ).filter((answer) => answer !== undefined)
  if (answers.length === 0) return void response.writeHead(202).end()
  return json(response, Array.isArray(parsed) ? answers : answers[0])
}

function authorize(header: string | undefined) {
  const presented = header?.startsWith("Bearer ") ? Buffer.from(header.slice(7)) : undefined
  if (!presented) return undefined
  return [...state.tokens].find(([token]) => {
    const expected = Buffer.from(token)
    return expected.length === presented.length && timingSafeEqual(expected, presented)
  })?.[1]
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > BODY_LIMIT) return undefined
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function parse(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function json(response: ServerResponse, value: unknown) {
  response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(value))
}

function reply(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result }
}

function error(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

function waitSeconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_WAIT_SECONDS
  return Math.min(MAX_WAIT_SECONDS, Math.max(0, Math.floor(value)))
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
