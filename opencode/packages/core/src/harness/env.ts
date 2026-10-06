export * as HarnessEnv from "./env"

/**
 * Environment for harness child processes. The app's full environment can hold
 * provider API keys and tokens, so harness processes only receive a small
 * launch allowlist plus the per-harness `env` from user configuration.
 */
const allowlist = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TERM",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "SystemRoot",
  "SystemDrive",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
]

export function harnessEnvironment(
  configEnv: Readonly<Record<string, string | undefined>> = {},
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of allowlist) {
    const value = source[name]
    if (value) env[name] = value
  }
  for (const [name, value] of Object.entries(configEnv)) {
    if (value) env[name] = value
  }
  return env
}
