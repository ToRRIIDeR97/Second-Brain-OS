import { spawn } from "node:child_process"
import { userInfo } from "node:os"
import { basename } from "node:path"

const TIMEOUT = 5_000

type Probe = { type: "Loaded"; value: Record<string, string> } | { type: "Timeout" } | { type: "Unavailable" }
type ShellEnvLogger = {
  log: (message: string) => void
}

export function resolveUserShell(envShell: string | undefined, loginShell: string | null | undefined) {
  const resolvedLoginShell = loginShell && loginShell !== "unknown" ? loginShell : undefined
  return envShell || resolvedLoginShell || "/bin/sh"
}

export function getUserShell() {
  try {
    return resolveUserShell(process.env.SHELL, userInfo().shell)
  } catch {
    return resolveUserShell(process.env.SHELL, undefined)
  }
}

export function parseShellEnv(out: Buffer) {
  const env: Record<string, string> = {}
  for (const line of out.toString("utf8").split("\0")) {
    if (!line) continue
    const ix = line.indexOf("=")
    if (ix <= 0) continue
    env[line.slice(0, ix)] = line.slice(ix + 1)
  }
  return env
}

// Async so the probe never blocks the main process. The child is killed on timeout.
function probe(shell: string, mode: "-il" | "-l", timeout: number) {
  return new Promise<Probe>((resolve) => {
    const chunks: Buffer[] = []
    let settled = false
    const settle = (result: Probe) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const child = spawn(shell, [mode, "-c", "env -0"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })
    // Interactive shells ignore SIGTERM, so a stuck probe is killed outright.
    const timer = setTimeout(() => {
      settle({ type: "Timeout" })
      child.kill("SIGKILL")
    }, timeout)

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.once("error", (err) => {
      if (!settled) console.log(`[server] Shell env probe failed for ${shell} ${mode}: ${err.message}`)
      settle({ type: "Unavailable" })
    })
    child.once("close", (code) => {
      if (settled) return
      if (code !== 0) {
        console.log(`[server] Shell env probe exited with non-zero status for ${shell} ${mode}`)
        settle({ type: "Unavailable" })
        return
      }
      const env = parseShellEnv(Buffer.concat(chunks))
      if (Object.keys(env).length === 0) {
        console.log(`[server] Shell env probe returned empty env for ${shell} ${mode}`)
        settle({ type: "Unavailable" })
        return
      }
      settle({ type: "Loaded", value: env })
    })
  })
}

export function isNushell(shell: string) {
  const name = basename(shell).toLowerCase()
  const raw = shell.toLowerCase()
  return name === "nu" || name === "nu.exe" || raw.endsWith("\\nu.exe")
}

export async function loadShellEnv(shell: string, logger: ShellEnvLogger, timeout = TIMEOUT) {
  if (isNushell(shell)) {
    logger.log(`[server] Skipping shell env probe for nushell: ${shell}`)
    return null
  }

  const interactive = await probe(shell, "-il", timeout)
  if (interactive.type === "Loaded") {
    logger.log(`[server] Loaded shell environment with -il (${Object.keys(interactive.value).length} vars)`)
    return interactive.value
  }
  // A slow `.zshrc` (nvm, conda, prompt frameworks) can time out the interactive probe; a login shell skips it.
  if (interactive.type === "Timeout") logger.log(`[server] Interactive shell env probe timed out: ${shell}`)

  const login = await probe(shell, "-l", timeout)
  if (login.type === "Loaded") {
    logger.log(`[server] Loaded shell environment with -l (${Object.keys(login.value).length} vars)`)
    return login.value
  }

  logger.log(`[server] Falling back to app environment: ${shell}`)
  return null
}

/**
 * PATH with the common install folders for CLIs and package managers appended when missing, for when no shell
 * environment loaded: a GUI app otherwise has only `/usr/bin:/bin:/usr/sbin:/sbin`, and every harness CLI looks
 * uninstalled. Existing entries keep their order.
 */
export function fallbackPath(path: string, home: string) {
  const entries = path.split(":").filter(Boolean)
  const extra = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.opencode/bin`,
  ]
  return [...entries, ...extra.filter((dir) => !entries.includes(dir))].join(":")
}

export function mergeShellEnv(shell: Record<string, string> | null, env: Record<string, string>) {
  return {
    ...shell,
    ...env,
  }
}
