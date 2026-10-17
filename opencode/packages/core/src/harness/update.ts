export * as HarnessUpdate from "./update"

import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { NpmConfig } from "../npm-config"
import type { AppProcess } from "../process"
import { which } from "../util/which"

// Where a harness CLI was installed from, read from the real path of its executable. Only these
// installs can be updated from the app; anything else (a standalone binary, a pnpm global, a
// script-installed copy) reports its probe version and is updated outside the app.
export type Source =
  | {
      readonly method: "npm" | "bun"
      readonly packageName: string
      readonly packageDir: string
      readonly prefix: string
    }
  | {
      readonly method: "brew"
      readonly name: string
      readonly cask: boolean
      readonly brew: string
      readonly version: string
    }

export interface Check {
  readonly version?: string
  readonly latest?: string
  readonly updateAvailable: boolean
  readonly method?: Source["method"]
  readonly error?: string
}

export class UpdateError extends Schema.TaggedErrorClass<UpdateError>()("HarnessUpdate.UpdateError", {
  reason: Schema.Literals(["not-found", "not-updatable", "update-failed"]),
  message: Schema.String,
}) {}

const checkTTL = 6 * 60 * 60 * 1000
const packageName = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const brewName = /^[a-z0-9][a-z0-9@._+-]*$/
// Latest-version lookups are network calls, so one result per executable is reused for a few hours.
const checks = new Map<string, { readonly expires: number; readonly check: Check }>()

/** Reads the install source from an executable's resolved path. */
export function sourceFromPath(file: string): Source | undefined {
  const normalized = file.replaceAll("\\", "/")
  const cellar = normalized.match(/^(.*)\/(Cellar|Caskroom)\/([^/]+)\/([^/]+)\//)
  if (cellar && brewName.test(cellar[3])) {
    return {
      method: "brew",
      name: cellar[3],
      cask: cellar[2] === "Caskroom",
      brew: path.join(cellar[1], "bin", "brew"),
      version: cellar[4].replace(/_\d+$/, ""),
    }
  }
  const index = normalized.indexOf("/node_modules/")
  if (index === -1) return
  const root = normalized.slice(0, index)
  const parts = normalized.slice(index + "/node_modules/".length).split("/")
  const name = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]
  if (!name || !packageName.test(name)) return
  const packageDir = `${root}/node_modules/${name}`
  if (root.endsWith("/.bun/install/global")) return { method: "bun", packageName: name, packageDir, prefix: root }
  // Unix globals live in <prefix>/lib/node_modules; Windows globals in %APPDATA%\npm\node_modules or
  // next to node.exe in a "nodejs" folder.
  if (root.endsWith("/lib")) return { method: "npm", packageName: name, packageDir, prefix: root.slice(0, -4) }
  if (/\/(npm|nodejs)$/i.test(root)) return { method: "npm", packageName: name, packageDir, prefix: root }
}

/** True when `latest` is a newer dotted version than `current`. Pre-release tags are ignored. */
export function newer(latest: string, current: string) {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(/[-+]/)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export const resolve = (command: string) =>
  Effect.promise(async () => {
    const found = command.includes("/") || command.includes("\\") ? command : which(command)
    if (!found) return
    const real = await fs.realpath(found).catch(() => undefined)
    return real ? { path: real, source: sourceFromPath(real) } : undefined
  })

export const check = Effect.fn("HarnessUpdate.check")(function* (
  process: Pick<AppProcess.Interface, "run">,
  command: string,
  fallbackVersion?: string,
) {
  const resolved = yield* resolve(command)
  if (!resolved) return { version: fallbackVersion, updateAvailable: false } satisfies Check
  const cached = checks.get(resolved.path)
  if (cached && cached.expires > Date.now()) return cached.check
  const source = resolved.source
  if (!source) return { version: fallbackVersion, updateAvailable: false } satisfies Check
  const result = yield* Effect.gen(function* () {
    const version = (yield* installedVersion(source)) ?? fallbackVersion
    const latest = yield* latestVersion(process, source)
    return {
      version,
      latest,
      method: source.method,
      updateAvailable: !!version && !!latest && newer(latest, version),
    } satisfies Check
  }).pipe(
    Effect.catch((error: unknown) =>
      Effect.succeed({
        version: fallbackVersion,
        method: source.method,
        updateAvailable: false,
        error: error instanceof Error ? error.message : "Could not check for updates.",
      } satisfies Check),
    ),
  )
  checks.set(resolved.path, { expires: Date.now() + checkTTL, check: result })
  return result
})

/** Runs the package manager that installed the CLI. The command is derived here, never from the caller. */
export const upgrade = Effect.fn("HarnessUpdate.upgrade")(function* (
  process: Pick<AppProcess.Interface, "run">,
  command: string,
) {
  const resolved = yield* resolve(command)
  const source = resolved?.source
  if (!resolved || !source)
    return yield* new UpdateError({
      reason: "not-updatable",
      message: `${command} was not installed with npm, Bun, or Homebrew, so update it the way you installed it.`,
    })
  const [bin, args] =
    source.method === "brew"
      ? [source.brew, ["upgrade", ...(source.cask ? ["--cask"] : []), source.name]]
      : source.method === "bun"
        ? ["bun", ["add", "--global", `${source.packageName}@latest`]]
        : ["npm", ["install", "--global", "--prefix", source.prefix, `${source.packageName}@latest`]]
  const result = yield* process
    .run(ChildProcess.make(bin, args, { cwd: os.homedir() }), { timeout: "5 minutes", maxErrorBytes: 16_384 })
    .pipe(
      Effect.mapError(
        (error) => new UpdateError({ reason: "update-failed", message: `Could not run ${bin}: ${error.message}` }),
      ),
    )
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim().split("\n").slice(-3).join("\n")
    return yield* new UpdateError({
      reason: "update-failed",
      message: `${bin} exited with code ${result.exitCode}${detail ? `: ${detail}` : "."}`,
    })
  }
  checks.delete(resolved.path)
})

function installedVersion(source: Source) {
  if (source.method === "brew") return Effect.succeed(source.version)
  return Effect.promise(() =>
    fs
      .readFile(path.join(source.packageDir, "package.json"), "utf8")
      .then((text) => {
        const version = (JSON.parse(text) as { version?: unknown }).version
        return typeof version === "string" ? version : undefined
      })
      .catch(() => undefined),
  )
}

function latestVersion(process: Pick<AppProcess.Interface, "run">, source: Source) {
  if (source.method === "brew") {
    return process
      .run(ChildProcess.make(source.brew, ["info", "--json=v2", ...(source.cask ? ["--cask"] : []), source.name]), {
        timeout: "30 seconds",
        maxOutputBytes: 4_000_000,
      })
      .pipe(
        Effect.map((result) => {
          const info = JSON.parse(result.stdout.toString()) as {
            formulae?: Array<{ versions?: { stable?: string } }>
            casks?: Array<{ version?: string }>
          }
          const version = source.cask ? info.casks?.[0]?.version : info.formulae?.[0]?.versions?.stable
          return version?.split(",")[0]
        }),
      )
  }
  return NpmConfig.registry(os.homedir()).pipe(
    Effect.flatMap((registry) =>
      Effect.tryPromise(async () => {
        const response = await fetch(`${registry}/${source.packageName}/latest`, {
          signal: AbortSignal.timeout(10_000),
          headers: { accept: "application/json" },
        })
        if (!response.ok) throw new Error(`The npm registry answered ${response.status}.`)
        const version = ((await response.json()) as { version?: unknown }).version
        return typeof version === "string" ? version : undefined
      }),
    ),
  )
}
