// Subprocess test harness for the opencode CLI. Spawns the real binary against
// a TestLLMServer running in-process at a random port, with full env isolation.
//
// This is the missing test tier: in-process tests can't catch bugs that span
// argv parsing → server boot → SDK call → event consumption → exit code (like
// the original /event race or #27371's invalid-model hang).
//
// Configuration flows through opencode's built-in test affordances:
//   - OPENCODE_CONFIG_CONTENT      : provider config inline, no files to find
//   - OPENCODE_TEST_HOME           : pins os.homedir() → tmpdir
//   - OPENCODE_DISABLE_PROJECT_CONFIG : skip walking up for opencode.json
//   - OPENCODE_PURE                : skip external plugin discovery + install
//   - OPENCODE_DISABLE_AUTOUPDATE / AUTOCOMPACT / MODELS_FETCH : no background work
// Plus HOME / XDG_* pointing at the tmpdir for belt-and-suspenders isolation.
//
// `opencode.serve(opts)` covers the long-lived server; `opencode.spawn(argv)`
// covers any other command.
import { test, type TestOptions } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { Deferred, Duration, Effect, Layer, Schedule, Scope, Stream } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import path from "node:path"
import { TestLLMServer } from "./llm-server"
import { testProviderConfig } from "./test-provider"
import { it } from "./effect"

const opencodeRoot = path.resolve(import.meta.dir, "../../")
const cliEntry = path.join(opencodeRoot, "src/index.ts")

// Wrap a Bun subprocess pipe (or any ReadableStream<Uint8Array>) as a Stream.
// Centralizes the `evaluate` + `onError` boilerplate and tags errors with the
// stream name so a stderr/stdout failure is greppable in logs.
function fromBunStream(name: string, get: () => ReadableStream<Uint8Array>) {
  return Stream.fromReadableStream({
    evaluate: get,
    onError: (cause) => new Error(`${name} stream error: ${String(cause)}`),
  })
}

// Long-lived processes (serve) want the same stderr drain: read every
// chunk, push to a tail buffer, swallow stream errors (the child closing the
// pipe is normal). `log: true` surfaces a real protocol error to logs so a
// regression doesn't silently disappear.
function forkStderrDrain(stream: ReadableStream<Uint8Array>, into: string[]) {
  return Effect.forkScoped(
    fromBunStream("stderr", () => stream).pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) => Effect.sync(() => into.push(chunk))),
      Effect.ignore({ log: true }),
    ),
  )
}

function isolatedEnv(home: string, configJson: string): Record<string, string> {
  return {
    OPENCODE_TEST_HOME: home,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_STATE_HOME: path.join(home, ".local/state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    OPENCODE_CONFIG_CONTENT: configJson,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_AUTH_CONTENT: "{}",
  }
}

export type RunResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

export type SpawnOpts = { readonly timeoutMs?: number; readonly env?: Record<string, string> }

// `opencode serve` is a long-lived process — it never exits on its own.
// `serve(opts)` therefore returns a handle inside the caller's Scope: the
// subprocess is killed when the scope closes (test end), and the URL the
// server actually bound to (port 0 means OS-assigned) is parsed off stdout.
export type ServeOpts = SpawnOpts & {
  readonly port?: number
  readonly hostname?: string
  readonly extraArgs?: string[]
  // How long to wait for the "listening on http://..." line before failing.
  // Default 15s — startup is dominated by bun's transpile + plugin init, not
  // the actual listen() call.
  readonly readyTimeoutMs?: number
}

export type ServeHandle = {
  // Full URL the server is bound to, e.g. "http://127.0.0.1:54321". Use this
  // as the base for HTTP requests in tests — never assume the port.
  readonly url: string
  readonly hostname: string
  readonly port: number
  // Sends SIGTERM. The scope finalizer also calls this, so tests rarely need
  // to invoke it directly — useful for tests that assert exit behavior.
  readonly kill: () => void
  // Resolves with the exit code once the process exits. Bun returns a number.
  readonly exited: Promise<number>
}

export type OpencodeCli = {
  // Spawn `opencode serve` and wait until it's listening. Long-lived: the
  // returned handle is killed when the caller's Scope closes. Fails if the
  // listening line doesn't appear within `readyTimeoutMs`.
  readonly serve: (opts?: ServeOpts) => Effect.Effect<ServeHandle, Error, Scope.Scope>
  // Escape hatch: any CLI invocation with full control over argv. Used to test
  // commands that don't yet have a typed builder.
  readonly spawn: (args: string[], opts?: SpawnOpts) => Effect.Effect<RunResult>
  // Convenience assertion. Dumps captured stderr/stdout on mismatch so CI
  // failures are debuggable without re-running locally.
  readonly expectExit: (result: RunResult, expected: number, label?: string) => void
}

export type CliFixture = {
  readonly llm: TestLLMServer["Service"]
  readonly home: string
  readonly opencode: OpencodeCli
}

// Provisions a TestLLMServer + tmpdir + spawn helper and invokes fn. Cleans
// up the tmpdir on scope exit. TestLLMServer.layer is provided internally so
// the caller doesn't need to wire it up — the fixture's lifetime is tied to
// the surrounding Scope.
export function withCliFixture<A, E>(
  fn: (input: CliFixture) => Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>,
): Effect.Effect<A, E | unknown, Scope.Scope> {
  return Effect.gen(function* () {
    const llm = yield* TestLLMServer
    const fs = yield* FSUtil.Service
    const appProc = yield* AppProcess.Service

    const home = yield* fs.makeTempDirectory({ prefix: "oc-cli-" })
    yield* Effect.addFinalizer(() =>
      fs
        .remove(home, { recursive: true })
        .pipe(Effect.retry(Schedule.spaced("50 millis").pipe(Schedule.both(Schedule.recurs(20)))), Effect.ignore),
    )

    const configJson = JSON.stringify(testProviderConfig(llm.url))
    const env = isolatedEnv(home, configJson)

    const spawn = Effect.fn("opencode.spawn")(function* (args: string[], opts?: SpawnOpts) {
      const start = Date.now()
      const timeoutMs = opts?.timeoutMs ?? 30_000
      // stdin: "ignore" so the child doesn't see a piped stdin and block
      // on `Bun.stdin.text()` (see src/cli/cmd/run.ts — non-TTY stdin is
      // consumed as the prompt). The old Process.run wrapper defaulted to
      // ignore; ChildProcess.make defaults to pipe, so we set it explicitly.
      const command = ChildProcess.make(process.execPath, ["run", "--conditions=browser", cliEntry, ...args], {
        cwd: home,
        env: { ...env, ...opts?.env },
        extendEnv: true,
        stdin: "ignore",
      })
      // Pass timeout to appProc.run rather than wrapping with
      // Effect.timeoutOrElse externally: AppProcess.run is itself scoped, so
      // its built-in timeout triggers the acquireRelease kill finalizer
      // inside cross-spawn-spawner *before* surfacing the AppProcessError —
      // guaranteeing the child is dead by the time the test continues.
      // External timeoutOrElse interrupts the run fiber but races the
      // scope close, which can leak the child past the test boundary.
      //
      // Catch AppProcessError (timeout OR spawn failure) and synthesize a
      // non-zero result so the test sees it via the usual `expectExit`
      // path rather than as an unhandled Effect failure.
      const result = yield* appProc.run(command, { timeout: Duration.millis(timeoutMs) }).pipe(
        Effect.catchTag("AppProcessError", (err) =>
          Effect.succeed({
            command: err.command,
            exitCode: err.exitCode ?? -1,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from((err.stderr ?? String(err.cause ?? err.message)) + "\n"),
            stdoutTruncated: false,
            stderrTruncated: false,
          } satisfies AppProcess.RunResult),
        ),
      )
      return {
        exitCode: result.exitCode,
        stdout: normalizeLines(result.stdout.toString()),
        stderr: normalizeLines(result.stderr.toString()),
        durationMs: Date.now() - start,
      }
    })

    const serve = Effect.fn("opencode.serve")(function* (opts?: ServeOpts) {
      const argv = ["serve"]
      // Default port 0 — let the OS pick a free port, parse the actual one
      // off stdout. Hard-coded ports flake under parallel tests.
      argv.push("--port", String(opts?.port ?? 0))
      if (opts?.hostname) argv.push("--hostname", opts.hostname)
      if (opts?.extraArgs) argv.push(...opts.extraArgs)

      // Acquire the subprocess; release sends SIGTERM and awaits exit on
      // scope close. Wrapped in Effect.ignore so a flaky kill doesn't surface
      // as a finalizer error during test teardown.
      const proc = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.spawn([process.execPath, "run", "--conditions=browser", cliEntry, ...argv], {
            cwd: home,
            env: { ...process.env, ...env, ...opts?.env },
            stdout: "pipe",
            stderr: "pipe",
          }),
        ),
        (p) =>
          Effect.promise(() => {
            p.kill()
            return p.exited
          }).pipe(Effect.ignore),
      )

      // Tail buffer so timeout failures can include stderr context. The fork
      // also keeps the OS pipe buffer from filling and wedging the child.
      const stderrChunks: string[] = []
      yield* forkStderrDrain(proc.stderr, stderrChunks)

      // Watch stdout line-by-line for the listening sentinel. Format
      // (see src/cli/cmd/serve.ts):
      //   "opencode server listening on http://<host>:<port>"
      const readyRe = /listening on (http:\/\/([^\s:]+):(\d+))/
      const readyDeferred = yield* Deferred.make<{ url: string; hostname: string; port: number }>()
      yield* Effect.forkScoped(
        fromBunStream("stdout", () => proc.stdout).pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) => {
            const m = line.match(readyRe)
            return m ? Deferred.succeed(readyDeferred, { url: m[1], hostname: m[2], port: Number(m[3]) }) : Effect.void
          }),
          Effect.ignore({ log: true }),
        ),
      )

      const readyTimeoutMs = opts?.readyTimeoutMs ?? 15_000
      const match = yield* Deferred.await(readyDeferred).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(readyTimeoutMs),
          orElse: () =>
            Effect.fail(
              new Error(
                `opencode serve did not become ready within ${readyTimeoutMs}ms\n` +
                  `stderr (last 2000):\n${stderrChunks.join("").slice(-2000)}`,
              ),
            ),
        }),
      )

      return {
        url: match.url,
        hostname: match.hostname,
        port: match.port,
        kill: () => {
          proc.kill()
        },
        exited: proc.exited as Promise<number>,
      } satisfies ServeHandle
    })

    const opencode: OpencodeCli = { serve, spawn, expectExit }

    return yield* fn({ llm, home, opencode })
    // FetchHttpClient is provided so test bodies can `yield* HttpClient.HttpClient`
    // and hit endpoints on `opencode.serve()` without rolling their own fetch.
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        TestLLMServer.layer,
        FetchHttpClient.layer,
        AppNodeBuilder.build(LayerNode.group([FSUtil.node, AppProcess.node])),
      ),
    ),
  )
}

function normalizeLines(value: string) {
  return value.replaceAll("\r\n", "\n")
}

// Convenience for the common assertion pattern. Dumps stderr/stdout when
// the exit code doesn't match — saves debugging time on CI failures.
function expectExit(result: RunResult, expected: number, label = "opencode") {
  if (result.exitCode === expected) return
  const tail = (s: string, n: number) => (s.length > n ? "..." + s.slice(-n) : s)
  // eslint-disable-next-line no-console
  console.error(`[${label}] expected exit ${expected}, got ${result.exitCode} after ${result.durationMs}ms`)
  // eslint-disable-next-line no-console
  console.error(`[${label}] stderr (last 2000):\n${tail(result.stderr, 2000)}`)
  // eslint-disable-next-line no-console
  console.error(`[${label}] stdout (last 500):\n${tail(result.stdout, 500)}`)
  throw new Error(`${label}: expected exit ${expected}, got ${result.exitCode}`)
}

// `cliIt.live(name, fixture => effect)` is the same as
// `it.live(name, () => withCliFixture(fixture))` — one fewer nesting level at
// every call site. Use this for any test that needs the opencode CLI fixture.
//
// Subprocess tests must run against the real clock — a TestClock-paused
// environment can't drive a child process. If you need `.only` or `.skip`, fall
// back to `it.live` + `withCliFixture` directly.
// Body's R is `Scope.Scope | never` so tests can yield* scope-requiring
// resources (e.g. `opencode.serve`) without an extra `Effect.scoped` wrapper —
// `withCliFixture`'s outer scope is the natural lifetime.
export const cliIt = {
  live: <A, E>(
    name: string,
    body: (input: CliFixture) => Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>,
    opts?: number | TestOptions,
  ) => it.live(name, () => withCliFixture(body), opts),
  concurrent: <A, E>(
    name: string,
    body: (input: CliFixture) => Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>,
    opts?: number | TestOptions,
  ) =>
    (process.platform === "win32" ? test : test.concurrent)(
      name,
      () => Effect.runPromise(Effect.scoped(withCliFixture(body))),
      opts,
    ),
}
