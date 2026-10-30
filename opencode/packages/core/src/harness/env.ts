export * as HarnessEnv from "./env"

/**
 * Environment for harness child processes. The app's full environment can hold
 * provider API keys and tokens, so harness processes only receive a small
 * launch allowlist plus the per-harness `env` from user configuration.
 */
const allowlist = [
  "PATH",
  "HOME",
  // Account names, not secrets. Harness CLIs that keep their sign-in in the OS keychain look it up by user name:
  // without USER, Claude Code on macOS can't find its keychain login and reports itself signed out.
  "USER",
  "LOGNAME",
  "USERNAME",
  // Network settings the user's tools need behind a proxy or a TLS-inspecting firewall. The app's own server
  // honours them; harnesses must too, or they can't reach their provider.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  // Where each CLI keeps its login and config, and which provider endpoint it uses. Without these a harness reads
  // a different login or provider than the same CLI in the user's terminal. Keys and tokens stay excluded.
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "ANTHROPIC_BASE_URL",
  "OPENAI_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "CLOUD_ML_REGION",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  // Tooling the agents' commands rely on: the user's shell, the SSH agent for git over ssh, editors, color.
  "SHELL",
  "SSH_AUTH_SOCK",
  "EDITOR",
  "VISUAL",
  "COLORTERM",
  "LC_CTYPE",
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
  // Harnesses reach the app's own MCP endpoint on 127.0.0.1; a proxy must never carry that, as the sidecar
  // ensures for itself.
  if (["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].some((name) => env[name])) {
    const hosts = [...(env.NO_PROXY ?? env.no_proxy ?? "").split(","), "127.0.0.1", "localhost", "::1"]
      .map((host) => host.trim())
      .filter(Boolean)
    env.NO_PROXY = env.no_proxy = [...new Set(hosts)].join(",")
  }
  return env
}
