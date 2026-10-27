export * as HarnessSetup from "./setup"

import { Harness } from "@opencode-ai/schema/harness"
import { Effect, Option, Schema, Semaphore } from "effect"
import { ChildProcess } from "effect/unstable/process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { AppProcess } from "../process"
import { which } from "../util/which"

/**
 * Day-one setup for the built-in external harnesses: install the CLI, then sign in through the
 * harness's own login or give it an API key. Only these recipes can be installed, so the package
 * name and login command always come from here, never from the caller.
 */
export interface Recipe {
  readonly id: Harness.InstanceID
  readonly packageName: string
  readonly command: string
  /** `link`: the server starts the login and returns a browser URL. `terminal`: the user runs `login` in a terminal. */
  readonly signIn: "link" | "terminal"
  readonly login?: ReadonlyArray<string>
  /** Keys this harness accepts. `env` keys are passed to the harness process; Codex stores its key itself. */
  readonly apiKeys: ReadonlyArray<{ readonly id: string; readonly label: string; readonly env?: string }>
}

export const recipes: ReadonlyArray<Recipe> = [
  {
    id: Harness.Codex,
    packageName: "@openai/codex",
    command: "codex",
    signIn: "link",
    apiKeys: [{ id: "openai", label: "OpenAI API key" }],
  },
  {
    id: Harness.ClaudeCode,
    packageName: "@agentclientprotocol/claude-agent-acp",
    command: "claude-agent-acp",
    signIn: "terminal",
    // The adapter's own ACP terminal-auth method: Claude's browser login for a Claude subscription.
    login: ["claude-agent-acp", "--cli", "auth", "login", "--claudeai"],
    apiKeys: [{ id: "anthropic", label: "Anthropic API key", env: "ANTHROPIC_API_KEY" }],
  },
  {
    id: Harness.OpenCodeAcp,
    packageName: "opencode-ai",
    command: "opencode",
    signIn: "terminal",
    login: ["opencode", "auth", "login"],
    apiKeys: [
      { id: "anthropic", label: "Anthropic API key", env: "ANTHROPIC_API_KEY" },
      { id: "openai", label: "OpenAI API key", env: "OPENAI_API_KEY" },
      { id: "openrouter", label: "OpenRouter API key", env: "OPENROUTER_API_KEY" },
    ],
  },
]

export const recipe = (id: string) => recipes.find((item) => item.id === id)

export class SetupError extends Schema.TaggedErrorClass<SetupError>()("HarnessSetup.SetupError", {
  reason: Schema.Literals(["not-found", "invalid-input", "install-failed", "sign-in-failed", "write-failed"]),
  message: Schema.String,
}) {}

/** Installs the recipe's npm package globally. npm must be on PATH; it ships with Node.js. */
export const install = Effect.fn("HarnessSetup.install")(function* (
  process: Pick<AppProcess.Interface, "run">,
  item: Recipe,
) {
  const npm = which("npm")
  if (!npm)
    return yield* new SetupError({
      reason: "install-failed",
      message: "npm is not on PATH. Install Node.js 22 or newer from https://nodejs.org, then try again.",
    })
  const result = yield* process
    .run(ChildProcess.make(npm, ["install", "--global", `${item.packageName}@latest`], { cwd: os.homedir() }), {
      timeout: "10 minutes",
      maxErrorBytes: 16_384,
    })
    .pipe(
      Effect.mapError(
        (error) => new SetupError({ reason: "install-failed", message: `Could not run npm: ${error.message}` }),
      ),
    )
  if (result.exitCode === 0) return undefined
  const detail = result.stderr.toString().trim().split("\n").slice(-3).join("\n")
  return yield* new SetupError({
    reason: "install-failed",
    message: `npm exited with code ${result.exitCode}${detail ? `: ${detail}` : "."}`,
  })
})

/**
 * Whether the harness's own login is present, read from the files each CLI writes. Claude Code records
 * the signed-in account as `oauthAccount` in `.claude.json` on every platform (the token itself may sit
 * in the macOS keychain). Nothing here reads a token.
 */
export const signedIn = (item: Recipe, env: Readonly<Record<string, string | undefined>> = process.env) =>
  Effect.promise(async (): Promise<"signed-in" | "signed-out" | "unknown"> => {
    const home = env.HOME ?? os.homedir()
    if (item.id === Harness.ClaudeCode) {
      const file = env.CLAUDE_CONFIG_DIR
        ? path.join(env.CLAUDE_CONFIG_DIR, ".claude.json")
        : path.join(home, ".claude.json")
      const value = await readJson(file)
      return isRecord(value) && isRecord(value.oauthAccount) ? "signed-in" : "signed-out"
    }
    if (item.id === Harness.OpenCodeAcp) {
      const value = await readJson(
        path.join(env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "opencode", "auth.json"),
      )
      return isRecord(value) && Object.keys(value).length > 0 ? "signed-in" : "signed-out"
    }
    return "unknown"
  })

export const fileName = "harness-credentials.json"
const writeLock = Semaphore.makeUnsafe(1)
// Bumped on every key change. Harness runtimes are built per Location, so each compares this before a
// turn and reloads its instances when another Location's Settings request changed a key.
let keysRevision = 0
export const keysVersion = () => keysRevision

/** API keys for built-in harnesses, one per harness: `{ [harnessID]: { option, key } }`. */
export type Keys = Readonly<Record<string, { readonly option: string; readonly key: string }>>

export const readKeys = (dataDir: string): Effect.Effect<Keys> =>
  Effect.promise(async () => {
    const value = await readJson(path.join(dataDir, fileName))
    if (!isRecord(value)) return {}
    return Object.fromEntries(
      Object.entries(value).flatMap(([id, entry]) =>
        isRecord(entry) && typeof entry.option === "string" && typeof entry.key === "string"
          ? [[id, { option: entry.option, key: entry.key }] as const]
          : [],
      ),
    )
  })

/** Stores or (with `undefined`) removes one harness's key. The file is written `0600` with an atomic rename. */
export const writeKey = (
  dataDir: string,
  id: string,
  value: { readonly option: string; readonly key: string } | undefined,
) =>
  Effect.gen(function* () {
    const current = yield* readKeys(dataDir)
    const next = Object.fromEntries(Object.entries({ ...current, [id]: value }).filter(([, entry]) => entry))
    yield* Effect.tryPromise({
      try: () => writeAtomic(path.join(dataDir, fileName), `${JSON.stringify(next, null, 2)}\n`),
      catch: (cause) =>
        new SetupError({ reason: "write-failed", message: `Could not save ${fileName}: ${String(cause)}` }),
    })
    keysRevision += 1
  }).pipe(writeLock.withPermits(1))

/** The environment a stored key adds to its harness process. */
export function keyEnvironment(item: Recipe | undefined, stored: Keys[string] | undefined): Record<string, string> {
  const env = item?.apiKeys.find((option) => option.id === stored?.option)?.env
  return env && stored ? { [env]: stored.key } : {}
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

async function readJson(file: string) {
  return Option.getOrUndefined(decodeJson(await fs.readFile(file, "utf8").catch(() => "")))
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
