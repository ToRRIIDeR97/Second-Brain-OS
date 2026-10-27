export * as ServerNetworkGuard from "./network-guard"

const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

export function isLoopback(hostname: string) {
  return loopback.has(hostname.toLowerCase()) || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

/**
 * An unauthenticated server gives anyone who can reach it file, shell and provider access,
 * so it may only listen on a loopback address. Set OPENCODE_SERVER_PASSWORD to listen wider.
 */
export function assertExposureAllowed(hostname: string, password: string | undefined) {
  if (isLoopback(hostname) || password) return
  throw new Error(
    `Refusing to listen on ${hostname} without authentication; set OPENCODE_SERVER_PASSWORD or use 127.0.0.1.`,
  )
}
