import type { AssistantMessage } from "@opencode-ai/sdk/v2/client"
import { pathKey } from "@/utils/path-key"

/**
 * The folder a thread runs in, named after its last path segment. It is a linked worktree when the project
 * lists it among its sandboxes (the Git worktrees beside the main checkout); the main checkout and folders
 * outside Git are plain folders.
 */
export function threadWorktree(input: {
  directory: string | undefined
  project: { worktree: string; sandboxes?: readonly string[] } | undefined
}) {
  const directory = input.directory
  if (!directory) return undefined
  const key = pathKey(directory)
  const linked =
    !!input.project &&
    pathKey(input.project.worktree) !== key &&
    !!input.project.sandboxes?.some((sandbox) => pathKey(sandbox) === key)
  return { name: folderName(directory), linked }
}

/**
 * The last response's tokens that make up the context total, largest first as the harness reports them;
 * parts the harness did not report are left out.
 */
export function contextTokenRows(tokens: AssistantMessage["tokens"]) {
  return (
    [
      { key: "cacheRead", value: tokens.cache.read },
      { key: "cacheWrite", value: tokens.cache.write },
      { key: "input", value: tokens.input },
      { key: "output", value: tokens.output },
      { key: "reasoning", value: tokens.reasoning },
    ] as const
  ).filter((row) => row.value > 0)
}

/** A token count's share of the context window: whole percents, one decimal under 1%, and "<0.1%" below that. */
export function formatShare(value: number, limit: number, locale: string) {
  const ratio = value / limit
  if (ratio > 0 && ratio < 0.001) return `<${percent(locale, 1).format(0.001)}`
  return percent(locale, ratio < 0.01 ? 1 : 0).format(ratio)
}

/** The thread's own harness report for the sheet, or undefined when that harness doesn't report usage. */
export function threadUsage<T extends { instanceID: string; status: string }>(
  reports: ReadonlyArray<T>,
  current: string | undefined,
) {
  return reports.find((item) => item.instanceID === current && item.status !== "unsupported")
}

/** How far off a usage window's reset is, as a locale's relative time ("in 3 hours"), in the largest whole unit. */
export function formatResetIn(resetsAt: number, now: number, locale: string) {
  const minutes = Math.max(1, Math.round((resetsAt - now) / 60_000))
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "always" })
  if (minutes < 60) return format.format(minutes, "minute")
  if (minutes < 48 * 60) return format.format(Math.round(minutes / 60), "hour")
  return format.format(Math.round(minutes / (24 * 60)), "day")
}

const percent = (locale: string, digits: number) =>
  new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits })

const folderName = (directory: string) => directory.split(/[\\/]/).filter(Boolean).pop() || directory
