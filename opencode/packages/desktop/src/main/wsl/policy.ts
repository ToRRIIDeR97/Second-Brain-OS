import type { WslDistroProbe, WslOpencodeCheck, WslServerItem } from "../../preload/types"

export function wslServerIdToRestart(servers: WslServerItem[], distro: string) {
  return servers.find((item) => item.config.distro === distro)?.config.id
}

export function clearWslDistroState(
  distroProbes: Record<string, WslDistroProbe>,
  opencodeChecks: Record<string, WslOpencodeCheck>,
  distro: string,
) {
  const nextDistroProbes = { ...distroProbes }
  const nextOpencodeChecks = { ...opencodeChecks }
  delete nextDistroProbes[distro]
  delete nextOpencodeChecks[distro]
  return { distroProbes: nextDistroProbes, opencodeChecks: nextOpencodeChecks }
}

// WSL distribution names are limited to letters, digits, ".", "_" and "-".
// Requiring a leading letter or digit also keeps a name from parsing as a
// wsl.exe option.
const WSL_DISTRO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// `start` is what gives the terminal its own console window from the GUI
// process, but cmd.exe re-parses the command line, so only an allowlisted
// distro name may reach it: none of cmd's metacharacters can pass the pattern.
export function wslTerminalArgs(distro?: string | null) {
  return ["/c", "start", "", "wsl.exe", ...(distro ? ["-d", requireWslDistro(distro)] : [])]
}

export function requireWslDistro(value: unknown) {
  if (typeof value === "string" && WSL_DISTRO_PATTERN.test(value)) return value
  throw new Error("Invalid distro")
}

// Probe lists come from the installed and online distro lists, so a name WSL
// itself might accept but the allowlist doesn't is skipped, not fatal.
export function validWslDistros(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Invalid distro")
  return value.filter((item): item is string => typeof item === "string" && WSL_DISTRO_PATTERN.test(item))
}

export function requireWslIpcString(name: string, value: unknown) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error(`Invalid ${name}`)
}
