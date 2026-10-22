export * as SkillToggle from "./toggle"

import fs from "fs/promises"
import path from "path"
import { Effect, Schema, Semaphore } from "effect"

/** Tenon's switched-off skills, by name, in its config directory. */
export const fileName = "skills.json"

const File = Schema.Struct({ disabled: Schema.Array(Schema.String) })
const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(File))
const writeLock = Semaphore.makeUnsafe(1)

export class WriteError extends Schema.TaggedErrorClass<WriteError>()("SkillToggle.WriteError", {
  message: Schema.String,
}) {}

type Contents =
  | { readonly state: "missing" }
  | { readonly state: "invalid" }
  | { readonly state: "ok"; disabled: string[] }

const load = (configDir: string) =>
  Effect.promise(() =>
    fs.readFile(path.join(configDir, fileName), "utf8").then(
      (text): Contents => {
        const decoded = decodeFile(text)
        return decoded._tag === "Some" ? { state: "ok", disabled: [...decoded.value.disabled] } : { state: "invalid" }
      },
      (): Contents => ({ state: "missing" }),
    ),
  )

/** The names of switched-off skills. A missing or malformed file switches nothing off. */
export const disabled = (configDir: string): Effect.Effect<ReadonlySet<string>> =>
  load(configDir).pipe(Effect.map((contents) => new Set(contents.state === "ok" ? contents.disabled : [])))

/**
 * Switches a skill on or off and returns the new set. Writes are serialized and atomic, and a malformed file
 * is reported rather than overwritten, so a hand edit is never lost.
 */
export const set = Effect.fn("SkillToggle.set")(function* (configDir: string, name: string, enabled: boolean) {
  return yield* writeLock.withPermit(
    Effect.gen(function* () {
      const contents = yield* load(configDir)
      if (contents.state === "invalid")
        return yield* new WriteError({
          message: `${fileName} isn't valid JSON of the form {"disabled": [...]}. Fix or remove it.`,
        })
      const current = new Set(contents.state === "ok" ? contents.disabled : [])
      if (enabled) current.delete(name)
      else current.add(name)
      const next = [...current].toSorted()
      yield* Effect.tryPromise({
        try: () => writeAtomic(path.join(configDir, fileName), `${JSON.stringify({ disabled: next }, null, 2)}\n`),
        catch: (error) => new WriteError({ message: `Couldn't save ${fileName}: ${String(error)}` }),
      })
      return new Set(next) as ReadonlySet<string>
    }),
  )
})

async function writeAtomic(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temp, content, { mode: 0o600 })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}
