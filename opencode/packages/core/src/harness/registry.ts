export * as HarnessRegistry from "./registry"

import { Harness } from "@opencode-ai/schema/harness"
import { Effect, Option, Schema, Semaphore } from "effect"
import { constants } from "fs"
import fs from "fs/promises"
import path from "path"
import { ConfigHarness } from "../config/harness"
import type { AppProcess } from "../process"
import { AcpHarness } from "./acp"

// The app-owned list of harnesses added after setup. It lives beside the global config and holds
// commands only: agents can't store environment variables here.
export const fileName = "harnesses.json"
export const reserved: ReadonlySet<string> = new Set([Harness.OpenCode, Harness.Codex])

const slug = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
// Serializes the read-modify-write of harnesses.json so concurrent registrations can't drop an entry.
const writeLock = Semaphore.makeUnsafe(1)

export const description = `Register an installed command-line agent as a Second Brain harness so the user can choose it for a Run.
Only use this when the user explicitly asks to add or install a harness. The command must speak the Agent Client Protocol (ACP) over stdio, for example \`gemini --experimental-acp\` or \`opencode acp\`. Install the program first with your normal tools if it is missing.
The user approves the exact command before Second Brain runs it. Second Brain then checks the ACP handshake and saves the harness. It appears in the harness picker without a restart.`

export const Input = Schema.Struct({
  id: Schema.String.annotate({ description: "Short unique ID: a letter, then letters, digits, '-' or '_'" }),
  name: Schema.String.pipe(Schema.optional).annotate({ description: "Display name" }),
  command: Schema.String.annotate({ description: "Executable name on PATH or absolute path" }),
  args: Schema.Array(Schema.String)
    .pipe(Schema.optional)
    .annotate({ description: 'Arguments that start ACP mode, e.g. ["--experimental-acp"]' }),
  models: Schema.Array(Schema.String).pipe(Schema.optional).annotate({ description: "Optional model IDs to offer" }),
})
export type Input = typeof Input.Type

export const inputJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Short unique ID: a letter, then letters, digits, '-' or '_'" },
    name: { type: "string", description: "Display name" },
    command: { type: "string", description: "Executable name on PATH or absolute path" },
    args: { type: "array", items: { type: "string" }, description: "Arguments that start ACP mode" },
    models: { type: "array", items: { type: "string" }, description: "Optional model IDs to offer" },
  },
  required: ["id", "command"],
  additionalProperties: false,
} as const

export class RegisterError extends Schema.TaggedErrorClass<RegisterError>()("HarnessRegistry.RegisterError", {
  reason: Schema.Literals([
    "invalid-input",
    "invalid-id",
    "reserved",
    "exists",
    "command-not-found",
    "denied",
    "probe-failed",
    "write-failed",
  ]),
  message: Schema.String,
}) {}

export interface Approval {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly args: ReadonlyArray<string>
}

export interface Registered extends Approval {
  readonly agentName?: string
  readonly version?: string
}

export interface Dependencies {
  readonly configDir: string
  readonly directory: string
  readonly existing: ReadonlySet<string>
  readonly process: Pick<AppProcess.Interface, "spawn">
  readonly approve: (approval: Approval) => Effect.Effect<boolean>
}

const decodeInput = Schema.decodeUnknownOption(Input)
const decodeInstance = Schema.decodeUnknownOption(ConfigHarness.Instance)
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

export const read = (configDir: string): Effect.Effect<Readonly<Record<string, ConfigHarness.Instance>>> =>
  readRaw(configDir).pipe(
    Effect.map((raw) =>
      Object.fromEntries(
        Object.entries(raw ?? {}).flatMap(([id, value]) => {
          const instance = Option.getOrUndefined(decodeInstance(value))
          return instance ? [[id, instance] as const] : []
        }),
      ),
    ),
    Effect.orElseSucceed(() => ({})),
  )

export const register = Effect.fn("HarnessRegistry.register")(function* (input: unknown, deps: Dependencies) {
  const decoded = Option.getOrUndefined(decodeInput(input))
  if (!decoded) return yield* fail("invalid-input", "Provide at least an id and a command.")
  const id = decoded.id.trim()
  if (!slug.test(id))
    return yield* fail(
      "invalid-id",
      `"${id}" is not a valid harness ID. Use a letter, then letters, digits, '-' or '_'.`,
    )
  if (reserved.has(id)) return yield* fail("reserved", `"${id}" is a built-in harness and can't be replaced.`)
  if (deps.existing.has(id) || (yield* read(deps.configDir))[id])
    return yield* fail("exists", `A harness with ID "${id}" already exists.`)
  const command = yield* resolveCommand(decoded.command.trim())
  if (!command) return yield* fail("command-not-found", `"${decoded.command}" is not an executable on PATH.`)

  const approval = { id, name: decoded.name?.trim() || id, command, args: decoded.args ?? [] }
  if (!(yield* deps.approve(approval))) return yield* fail("denied", "The user declined registering this harness.")

  const settings = { command, args: approval.args, env: {}, models: decoded.models ?? [] }
  const agent = yield* AcpHarness.handshake(deps.process, settings, deps.directory).pipe(
    Effect.mapError((error) =>
      registerError("probe-failed", `${command} did not complete an ACP handshake: ${error.message}`),
    ),
  )

  yield* Effect.gen(function* () {
    const raw = yield* readRaw(deps.configDir).pipe(
      Effect.mapError(() => registerError("write-failed", `${fileName} is not valid JSON; fix or remove it first.`)),
    )
    if (raw?.[id]) return yield* fail("exists", `A harness with ID "${id}" already exists.`)
    const next = {
      ...raw,
      [id]: {
        driver: Harness.AcpDriver,
        name: approval.name,
        config: { command, args: approval.args, ...(settings.models.length ? { models: settings.models } : {}) },
      },
    }
    yield* Effect.tryPromise({
      try: () => writeAtomic(path.join(deps.configDir, fileName), `${JSON.stringify(next, null, 2)}\n`),
      catch: (cause) => registerError("write-failed", `Could not save ${fileName}: ${String(cause)}`),
    })
  }).pipe(writeLock.withPermits(1))
  return { ...approval, agentName: agent.name, version: agent.version } satisfies Registered
})

export function summary(result: Registered) {
  const agent = [result.agentName, result.version].filter(Boolean).join(" ")
  return `Registered harness "${result.id}" (${result.name})${agent ? `, ACP agent ${agent}` : ""}. It is now available in the harness picker.`
}

function readRaw(configDir: string) {
  const file = Bun.file(path.join(configDir, fileName))
  return Effect.tryPromise({
    try: async () => ((await file.exists()) ? file.text() : undefined),
    catch: (cause) => cause,
  }).pipe(
    Effect.flatMap((text) => {
      if (text === undefined) return Effect.succeed(undefined)
      const value = Option.getOrUndefined(decodeJson(text))
      return isRecord(value) ? Effect.succeed(value) : Effect.fail(new Error(`${fileName} is not a JSON object.`))
    }),
  )
}

function resolveCommand(command: string) {
  return Effect.promise(async () => {
    if (!command) return undefined
    const expanded = AcpHarness.expandHome(command)
    const candidate =
      expanded.includes("/") || expanded.includes("\\")
        ? path.resolve(expanded)
        : (Bun.which(expanded, { PATH: process.env.PATH ?? "" }) ?? undefined)
    if (!candidate) return undefined
    const stat = await fs.stat(candidate).catch(() => undefined)
    if (!stat?.isFile()) return undefined
    return fs.access(candidate, constants.X_OK).then(
      () => candidate,
      () => undefined,
    )
  })
}

async function writeAtomic(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temp, content, { mode: 0o600 })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}

function registerError(reason: RegisterError["reason"], message: string) {
  return new RegisterError({ reason, message })
}

function fail(reason: RegisterError["reason"], message: string) {
  return Effect.fail(registerError(reason, message))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
