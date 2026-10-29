export * as HarnessCatalogCache from "./catalog-cache"

import fs from "fs/promises"
import path from "path"
import { Effect, Option, Schema, Semaphore } from "effect"
import { Harness } from "@opencode-ai/schema/harness"
import { Hash } from "../util/hash"

/**
 * The model lists harnesses last reported, kept across restarts so the picker has models before the
 * harness CLIs answer. Rebuildable: a missing or corrupt file only means the next check discovers again.
 * Entries are keyed by a hash of the instance key, because an instance's config can carry API keys.
 */
export const fileName = "harness-models.json"

const Entry = Schema.Struct({ models: Schema.Array(Harness.Model), checked: Schema.Number })
export type Entry = typeof Entry.Type
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Entry)))
const writeLock = Semaphore.makeUnsafe(1)

export const id = (instanceKey: string) => Hash.sha256(instanceKey)

export const read = (dataDir: string): Effect.Effect<Readonly<Record<string, Entry>>> =>
  Effect.promise(async () =>
    Option.getOrElse(decode(await fs.readFile(path.join(dataDir, fileName), "utf8").catch(() => "")), () => ({})),
  )

/** Stores one instance's list, keeping the entries other Locations wrote. A failed write is ignored. */
export const write = (dataDir: string, instanceKey: string, entry: Entry) =>
  read(dataDir).pipe(
    Effect.flatMap((current) =>
      Effect.promise(async () => {
        const file = path.join(dataDir, fileName)
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`
        await fs.mkdir(dataDir, { recursive: true })
        await fs
          .writeFile(temp, JSON.stringify({ ...current, [id(instanceKey)]: entry }))
          .then(() => fs.rename(temp, file))
          .catch(() => fs.rm(temp, { force: true }))
      }),
    ),
    writeLock.withPermits(1),
  )
