export * as Database from "./database"

import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { chmod } from "fs/promises"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

const layer = (filename: string) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const db = yield* makeDatabase

      // The driver opens the connection with the busy timeout and WAL journal mode already set.
      yield* db.run("PRAGMA synchronous = NORMAL")
      yield* db.run("PRAGMA cache_size = -64000")
      yield* db.run("PRAGMA foreign_keys = ON")
      yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
      yield* restrictPermissions(filename)
      yield* DatabaseMigration.apply(db)

      return { db }
    }).pipe(Effect.orDie),
  )

export function layerFromPath(filename: string) {
  return layer(filename).pipe(Layer.provide(sqliteLayer({ filename, timeout: 5000 })))
}

// The database stores provider credentials. SQLite creates the -wal and -shm files with the
// database file's mode, but files left by an older build may still be world-readable.
function restrictPermissions(filename: string) {
  if (filename === ":memory:" || process.platform === "win32") return Effect.void
  return Effect.promise(() =>
    Promise.all(["", "-wal", "-shm"].map((suffix) => chmod(filename + suffix, 0o600).catch(() => undefined))),
  )
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  if (
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, "opencode.db")
  return join(Global.Path.data, `opencode-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
