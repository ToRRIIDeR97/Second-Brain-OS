import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app, utilityProcess } from "electron"
import type { Details } from "electron"
import { CHANNEL } from "./constants"
import { stableDatabaseName } from "./database-name"
import { getLogger } from "./logging"
import { getUserShell, loadShellEnv } from "./shell-env"
import { getStore } from "./store"
import { DEFAULT_SERVER_URL_KEY } from "./store-keys"

type SidecarMessage =
  | { type: "ready" }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }

export type SidecarListener = { stop: () => Promise<void> }

const SIDECAR_SERVICE_NAME = "opencode server"
const SIDECAR_START_STALL_TIMEOUT = 60_000
const SIDECAR_STOP_TIMEOUT = 6_000

type SpawnLocalServerOptions = {
  userDataPath: string
  onStdout?: (message: string) => void
  onStderr?: (message: string) => void
  onExit?: (code: number) => void
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

// Async so the login-shell probe runs alongside app startup; it must finish before the sidecar env is built.
export async function preferAppEnv(userDataPath: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? await loadShellEnv(shell, getLogger()) : null
  Object.assign(process.env, {
    ...shellEnv,
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_CLIENT: "desktop",
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
  })
  // A set OPENCODE_DB wins: the onboarding test uses ":memory:", and a user may pick their own file. Assigning
  // undefined to process.env would store the string "undefined", so it is set only when there is a name.
  const database = stableDatabaseName(CHANNEL, app.isPackaged)
  if (!process.env.OPENCODE_DB && database) process.env.OPENCODE_DB = database
  return shellEnv
}

// Returns at once so the caller can stop the child while it is still starting.
export function spawnLocalServer(hostname: string, port: number, password: string, options: SpawnLocalServerOptions) {
  const sidecar = join(dirname(fileURLToPath(import.meta.url)), "sidecar.js")
  const child = utilityProcess.fork(sidecar, [], {
    cwd: process.cwd(),
    env: createSidecarEnv(),
    serviceName: SIDECAR_SERVICE_NAME,
    stdio: "pipe",
  })
  let exited = false
  const exit = defer<number>()

  const onProcessGone = (_event: unknown, details: Details) => {
    if (details.type !== "Utility" || details.name !== SIDECAR_SERVICE_NAME) return
    options.onStderr?.(`utility process gone reason=${details.reason} exitCode=${details.exitCode}`)
  }

  app.on("child-process-gone", onProcessGone)
  child.once("exit", (code) => {
    exited = true
    app.off("child-process-gone", onProcessGone)
    options.onExit?.(code)
    exit.resolve(code)
  })
  child.on("error", (error) => options.onStderr?.(`utility process error: ${serializeError(error).message}`))

  child.stdout?.on("data", (chunk: Buffer) => options.onStdout?.(chunk.toString("utf8").trimEnd()))
  child.stderr?.on("data", (chunk: Buffer) => options.onStderr?.(chunk.toString("utf8").trimEnd()))

  const ready = new Promise<void>((resolve, reject) => {
    let done = false
    let timeout: NodeJS.Timeout

    const fail = (error: Error) => {
      if (done) return
      done = true
      cleanup()
      reject(error)
    }

    const refreshTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        fail(new Error(`Sidecar did not become ready within ${SIDECAR_START_STALL_TIMEOUT}ms: ${sidecar}`))
      }, SIDECAR_START_STALL_TIMEOUT)
    }

    const onMessage = (message: SidecarMessage) => {
      if (message.type === "ready") {
        if (done) return
        done = true
        cleanup()
        resolve()
        return
      }
      if (message.type === "error") {
        fail(Object.assign(new Error(message.error.message), { stack: message.error.stack }))
      }
    }
    const onExit = (code: number) => {
      fail(new Error(`Sidecar exited before ready with code ${code}`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.off("message", onMessage)
      child.off("exit", onExit)
    }

    child.on("message", onMessage)
    child.on("exit", onExit)
    refreshTimeout()
    child.postMessage({
      type: "start",
      hostname,
      port,
      password,
      userDataPath: options.userDataPath,
    })
  }).catch((error) => {
    if (!exited) child.kill()
    throw error
  })

  // Polls until healthy; stops when the signal aborts (for example on a timeout) or the child exits.
  const waitHealthy = async (signal: AbortSignal) => {
    await ready
    const gone = new AbortController()
    void exit.promise.then(() => gone.abort())
    const stop = AbortSignal.any([signal, gone.signal])
    const url = `http://${hostname}:${port}`
    // Probe first: a fast sidecar is often healthy by the time it reports ready.
    while (!stop.aborted) {
      if (await checkHealth(url, password, stop)) return
      await delay(100)
    }
    if (exited) throw new Error(`Sidecar exited before health check passed with code ${await exit.promise}`)
    throw new Error("Sidecar health check aborted")
  }

  let stopping: Promise<void> | undefined

  return {
    ready,
    exited: exit.promise,
    waitHealthy,
    stop: () => {
      if (stopping) return stopping
      if (exited) return Promise.resolve()
      child.postMessage({ type: "stop" })
      stopping = Promise.race([
        exit.promise.then(() => undefined),
        delay(SIDECAR_STOP_TIMEOUT).then(() => {
          if (!exited) child.kill()
        }),
      ])
      return stopping
    },
  }
}

// The path that last answered is tried first, so later polls make one request instead of two.
let healthPaths = ["/api/health", "/global/health"]

export async function checkHealth(url: string, password?: string | null, signal?: AbortSignal): Promise<boolean> {
  try {
    new URL(url)
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  for (const path of healthPaths) {
    if (signal?.aborted) return false
    try {
      const res = await fetch(new URL(path, url), {
        method: "GET",
        headers,
        signal: signal ? AbortSignal.any([AbortSignal.timeout(3000), signal]) : AbortSignal.timeout(3000),
      })
      if (!res.ok) continue
      healthPaths = [path, ...healthPaths.filter((item) => item !== path)]
      return true
    } catch {}
  }
  return false
}

function createSidecarEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  delete env.DEBUG
  if (process.platform === "linux") delete env.LD_PRELOAD
  return env
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
