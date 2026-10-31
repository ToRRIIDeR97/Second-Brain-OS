import { describe, expect, test } from "bun:test"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { tmpdir } from "./fixture/tmpdir"

// The desktop server runs the node:sqlite driver under Node. Bun only has node:sqlite in some versions (the pinned
// 1.3.14 doesn't), so the suite runs where the module exists and is skipped, not failed, where it doesn't.
const supported = await import("node:sqlite").then(
  () => true,
  () => false,
)
const { layer } = supported ? await import("@opencode-ai/core/database/sqlite.node") : { layer: undefined }

describe.skipIf(!supported)("node:sqlite driver", () => {
  test("sets the busy timeout and WAL mode when the connection opens", async () => {
    await using tmp = await tmpdir()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        return [yield* db.get(sql`PRAGMA busy_timeout`), yield* db.get(sql`PRAGMA journal_mode`)]
      }).pipe(Effect.provide(layer!({ filename: path.join(tmp.path, "node.db"), timeout: 1234 })), Effect.scoped),
    )
    expect(result).toEqual([{ timeout: 1234 }, { journal_mode: "wal" }])
  })

  test("reuses cached statements for row objects and value arrays past the cache size", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* EffectDrizzleSqlite.makeWithDefaults()
        yield* db.run(sql`CREATE TABLE item (id integer PRIMARY KEY, name text NOT NULL)`)
        yield* db.run(sql`INSERT INTO item (name) VALUES ('a'), ('b')`)
        const query = sql`SELECT id, name FROM item ORDER BY id`
        const values = yield* db.values(query)
        const rows = yield* db.all(query)
        yield* Effect.forEach(
          Array.from({ length: 250 }, (_, i) => i),
          (i) => db.get(sql.raw(`SELECT ${i} AS n`)),
        )
        return { values, rows, again: yield* db.all(query) }
      }).pipe(Effect.provide(layer!({ filename: ":memory:" })), Effect.scoped),
    )
    expect(result.values).toEqual([
      [1, "a"],
      [2, "b"],
    ])
    expect(result.rows).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ])
    expect(result.again).toEqual(result.rows)
  })
})
