export * as HarnessRegistry from "./registry"

import { Harness } from "@opencode-ai/schema/harness"
import { Effect, Option, Schema, Semaphore } from "effect"
import { constants } from "fs"
import fs from "fs/promises"
import path from "path"
import { ConfigHarness } from "../config/harness"
import type { AppProcess } from "../process"
import { which } from "../util/which"
import { AcpHarness } from "./acp"

// The app-owned list of harnesses added after setup. It lives beside the global config and holds
// commands only: agents can't store environment variables here.
export const fileName = "harnesses.json"
export const reserved: ReadonlySet<string> = new Set([Harness.OpenCode, Harness.Codex])

const slug = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
// Serializes the read-modify-write of harnesses.json so concurrent registrations can't drop an entry.
const writeLock = Semaphore.makeUnsafe(1)

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

export class RegisterError extends Schema.TaggedErrorClass<RegisterError>()("HarnessRegistry.RegisterError", {
  reason: Schema.Literals([
    "invalid-input",
    "invalid-id",
    "reserved",
    "exists",
    "command-not-found",
    "probe-failed",
    "not-found",
    "read-only",
    "write-failed",
  ]),
  message: Schema.String,
}) {}

export interface Registered {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly agentName?: string
  readonly version?: string
}

export interface Discovery {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly agentName?: string
  readonly version?: string
  readonly models: ReadonlyArray<Harness.Model>
}

export interface Dependencies {
  readonly configDir: string
  readonly directory: string
  readonly existing: ReadonlySet<string>
  readonly process: Pick<AppProcess.Interface, "spawn">
}

const decodeInput = Schema.decodeUnknownOption(Input)
const decodeDiscoverInput = Schema.decodeUnknownOption(Harness.DiscoverInput)
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

  // Registration is a user action in Settings, so there is no separate approval step.
  const entry = { id, name: decoded.name?.trim() || id, command, args: decoded.args ?? [] }
  const settings = { command, args: entry.args, env: {}, models: decoded.models ?? [] }
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
        name: entry.name,
        config: { command, args: entry.args, ...(settings.models.length ? { models: settings.models } : {}) },
      },
    }
    yield* Effect.tryPromise({
      try: () => writeAtomic(path.join(deps.configDir, fileName), `${JSON.stringify(next, null, 2)}\n`),
      catch: (cause) => registerError("write-failed", `Could not save ${fileName}: ${String(cause)}`),
    })
  }).pipe(writeLock.withPermits(1))
  return { ...entry, agentName: agent.name, version: agent.version } satisfies Registered
})

export const setEnabled = (configDir: string, id: string, enabled: boolean) =>
  update(configDir, id, (entry) => ({
    ...Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "enabled")),
    ...(enabled ? {} : { enabled: false }),
  }))

export const remove = (configDir: string, id: string) => update(configDir, id, () => undefined)

/** Runs the ACP handshake and opens a session to list models. Nothing is written. */
export const discover = Effect.fn("HarnessRegistry.discover")(function* (
  input: unknown,
  deps: Pick<Dependencies, "directory" | "process">,
) {
  const decoded = Option.getOrUndefined(decodeDiscoverInput(input))
  if (!decoded?.command.trim()) return yield* fail("invalid-input", "Provide a command.")
  const command = yield* resolveCommand(decoded.command.trim())
  if (!command) return yield* fail("command-not-found", `"${decoded.command}" is not an executable on PATH.`)
  const args = decoded.args ?? []
  const agent = yield* AcpHarness.discover(deps.process, { command, args, env: {}, models: [] }, deps.directory).pipe(
    Effect.mapError((error) =>
      registerError("probe-failed", `${command} did not complete an ACP handshake: ${error.message}`),
    ),
  )
  return { command, args, agentName: agent.name, version: agent.version, models: agent.models } satisfies Discovery
})

// Read-modify-write of one existing entry under the shared lock. `change` returns the new entry,
// or undefined to delete it. A malformed file is reported and never overwritten.
function update(
  configDir: string,
  id: string,
  change: (entry: Record<string, unknown>) => Record<string, unknown> | undefined,
) {
  return Effect.gen(function* () {
    if (reserved.has(id)) return yield* fail("reserved", `"${id}" is a built-in harness and can't be changed.`)
    const raw = yield* readRaw(configDir).pipe(
      Effect.mapError(() => registerError("write-failed", `${fileName} is not valid JSON; fix or remove it first.`)),
    )
    const current = raw?.[id]
    if (!raw || !isRecord(current)) return yield* fail("not-found", `No registered harness has ID "${id}".`)
    const next = change(current)
    const entries = Object.fromEntries(
      Object.entries(raw).flatMap(([key, value]) => (key !== id ? [[key, value]] : next ? [[key, next]] : [])),
    )
    yield* Effect.tryPromise({
      try: () => writeAtomic(path.join(configDir, fileName), `${JSON.stringify(entries, null, 2)}\n`),
      catch: (cause) => registerError("write-failed", `Could not save ${fileName}: ${String(cause)}`),
    })
  }).pipe(writeLock.withPermits(1))
}

// The desktop app runs core under Node, so file and PATH lookups here must not use Bun globals.
function readRaw(configDir: string) {
  return Effect.tryPromise({
    try: () =>
      fs.readFile(path.join(configDir, fileName), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      }),
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
      expanded.includes("/") || expanded.includes("\\") ? path.resolve(expanded) : (which(expanded) ?? undefined)
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
