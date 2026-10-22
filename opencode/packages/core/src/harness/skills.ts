export * as HarnessSkills from "./skills"

import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Harness as HarnessSchema } from "@opencode-ai/schema/harness"
import { ConfigMarkdown } from "../config/markdown"
import { Global } from "../global"
import { HarnessRuntime } from "../harness"
import { Location } from "../location"
import { SkillV2 } from "../skill"
import { Glob } from "../util/glob"

export type Harness = { id: string; driver: string; command?: string }
export type Reported = ReadonlyArray<{ name: string; description?: string }>
export type Skill = { name: string; description?: string; location?: string; scope: "global" | "project" }
export type Source = "filesystem" | "reported" | "none"

/**
 * Skills a harness can use, read from the folders that harness loads them from. Read-only: only names,
 * descriptions and file paths are returned, never skill content. A harness without known folders falls
 * back to the commands it reported over ACP.
 */
export const scan = Effect.fn("HarnessSkills.scan")(function* (input: {
  home: string
  directory: string
  harness: Harness
  reported?: Reported
}) {
  const folders = locations(input.harness)
  if (!folders) return fromReport(input.harness, input.reported)
  const roots = [
    ...folders.global.map((folder) => ({ root: path.join(input.home, folder), scope: "global" as const })),
    ...folders.project.map((folder) => ({ root: path.join(input.directory, folder), scope: "project" as const })),
  ]
  const seen = new Set<string>()
  const skills: Skill[] = []
  for (const item of roots) {
    for (const location of yield* skillFiles(item.root)) {
      if (seen.has(location)) continue
      seen.add(location)
      const skill = yield* read(location, item.scope)
      if (skill) skills.push(skill)
    }
  }
  return { source: "filesystem" as Source, skills }
})

/**
 * Tenon's skills, then the skills of every external harness in settings order. Settings come from the
 * registry and config, so building the catalog never starts a harness CLI. The in-process agent is left
 * out: its skills are Tenon's.
 */
export const catalog = Effect.fn("HarnessSkills.catalog")(function* () {
  const skills = yield* SkillV2.Service
  const harnesses = yield* HarnessRuntime.Service
  const location = yield* Location.Service
  const tenon = tenonSkills(yield* skills.list(), yield* skills.sources())
  const external = (yield* harnesses.settings()).filter((entry) => entry.driver !== HarnessSchema.OpenCodeDriver)
  return {
    tenon,
    harnesses: yield* Effect.forEach(external, (entry) =>
      scan({
        // Global.Service lives outside location scope; its home is this same path.
        home: Global.Path.home,
        directory: location.directory,
        harness: { id: entry.id, driver: entry.driver, command: entry.command },
        reported: harnesses.reportedCommands(entry.id),
      }).pipe(Effect.map((result) => ({ id: entry.id, name: entry.name, ...result }))),
    ),
  }
})

/** Tenon's skills for the catalog. Embedded skills ship inside the app, so they have no file location. */
export function tenonSkills(skills: ReadonlyArray<SkillV2.Info>, sources: ReadonlyArray<SkillV2.Source>): Skill[] {
  // A file-based skill can replace an embedded one of the same name, so match the location too.
  const embedded = new Set(
    sources.flatMap((source) => (source.type === "embedded" ? [`${source.skill.name}\0${source.skill.location}`] : [])),
  )
  return skills.map((skill) => ({
    name: skill.name,
    ...(skill.description === undefined ? {} : { description: skill.description }),
    ...(embedded.has(`${skill.name}\0${skill.location}`) ? {} : { location: skill.location }),
    scope: "global",
  }))
}

/** Folders relative to the home and project directories, or undefined when the harness has none known. */
export function locations(harness: Harness) {
  if (harness.driver === "codex")
    return { global: [".codex/skills", ".agents/skills"], project: [".codex/skills", ".agents/skills"] }
  if (harness.driver !== "acp") return undefined
  const command = commandName(harness.command)
  // Assumed from OpenCode's documented skill folders, which include Claude and agent-standard ones.
  if (command.startsWith("opencode"))
    return {
      global: [".config/opencode/skill", ".config/opencode/skills", ".claude/skills", ".agents/skills"],
      project: [".opencode/skill", ".opencode/skills", ".claude/skills", ".agents/skills"],
    }
  if (command.startsWith("claude")) return { global: [".claude/skills"], project: [".claude/skills"] }
  return undefined
}

/** The command's file name, lowercased and without extension, for either path style. */
function commandName(command: string | undefined) {
  const base = (command ?? "").trim().split(/[\\/]/).at(-1) ?? ""
  const dot = base.lastIndexOf(".")
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase()
}

function fromReport(harness: Harness, reported: Reported | undefined) {
  if (harness.driver !== "acp" || !reported?.length) return { source: "none" as Source, skills: [] as Skill[] }
  return {
    source: "reported" as Source,
    skills: reported.map(
      (item): Skill => ({
        name: item.name,
        ...(item.description === undefined ? {} : { description: item.description }),
        scope: "global",
      }),
    ),
  }
}

// A missing or unreadable folder simply has no skills.
const skillFiles = (root: string) =>
  Effect.tryPromise(() => Glob.scan("**/SKILL.md", { cwd: root, absolute: true, dot: true, symlink: true })).pipe(
    Effect.map((files) => files.toSorted()),
    Effect.catch(() => Effect.succeed([] as string[])),
  )

const read = (location: string, scope: Skill["scope"]) =>
  Effect.tryPromise(() => fs.readFile(location, "utf8")).pipe(
    Effect.map((content): Skill => {
      const data = ConfigMarkdown.parseOption(content)?.data
      const name =
        typeof data?.name === "string" && data.name.trim() ? data.name.trim() : path.basename(path.dirname(location))
      const description = typeof data?.description === "string" ? data.description : undefined
      return { name, ...(description === undefined ? {} : { description }), location, scope }
    }),
    Effect.catch(() => Effect.succeed(undefined)),
  )
