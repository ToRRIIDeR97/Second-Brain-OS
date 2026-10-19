export * as ChildEnv from "./child-env"

/**
 * Variables that authenticate a client to the local server. Terminals, agent shell commands, and
 * MCP or LSP servers run code the user or the model chose, so they must not inherit them. Every
 * other variable is kept so user tools keep working.
 */
const serverCredentials = new Set(["OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME"])

/** Returns a copy of `source` (default `process.env`) without the server credential variables. */
export function from(source: Readonly<Record<string, string | undefined>> = process.env) {
  // Windows environment names are case-insensitive.
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => !serverCredentials.has(name.toUpperCase())),
  ) as Record<string, string | undefined>
}
