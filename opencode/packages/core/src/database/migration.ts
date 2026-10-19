export * as DatabaseMigration from "./migration"

import { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { sql } from "drizzle-orm"
import { Effect, Semaphore } from "effect"
import type { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { migrations } from "./migration.gen"
import schema from "./schema.gen"

type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
const lock = Semaphore.makeUnsafe(1)

/** Pre-migration backups kept next to the database file. */
export const BACKUPS_KEPT = 3
// Another process may hold the write lock while it migrates; wait for it instead of failing.
const MIGRATION_BUSY_TIMEOUT = 60_000
const STALE_BACKUP_TEMP = 60 * 60_000

export type Migration = {
  id: string
  up: (tx: Transaction) => Effect.Effect<void, unknown>
}

export function apply(db: Database) {
  return lock.withPermit(
    Effect.gen(function* () {
      const tables = yield* db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      if (tables.some((table) => table.name === "session")) return yield* applyOnly(db, migrations)
      if (tables.length > 0) return yield* Effect.die("Database is not empty and has no session table")
      const created = yield* db.transaction(
        (tx) =>
          Effect.gen(function* () {
            // Another process may have created the schema since the check above.
            if (yield* tx.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`))
              return false
            yield* schema.up(tx)
            yield* tx.run(
              sql`CREATE TABLE ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
            )
            yield* Effect.forEach(migrations, (migration) =>
              tx.run(
                sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
              ),
            )
            return true
          }),
        { behavior: "immediate" },
      )
      return created ? undefined : yield* applyOnly(db, migrations)
    }),
  )
}

export function applyOnly(db: Database, input: Migration[]) {
  return Effect.gen(function* () {
    yield* db.run(
      sql`CREATE TABLE IF NOT EXISTS ${sql.identifier("migration")} (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`,
    )
    let completed = new Set(
      (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
    )
    if (completed.size === 0) {
      // Existing installs used Drizzle's migration journal. Seed the new
      // journal once so TypeScript migrations don't replay old SQL.
      if (
        yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${"__drizzle_migrations"}`)
      ) {
        yield* db.run(sql`
          INSERT OR IGNORE INTO ${sql.identifier("migration")} (id, time_completed)
          SELECT name, ${Date.now()}
          FROM ${sql.identifier("__drizzle_migrations")}
          WHERE name IS NOT NULL
        `)
        completed = new Set(
          (yield* db.all<{ id: string }>(sql`SELECT id FROM ${sql.identifier("migration")}`)).map((row) => row.id),
        )
      }
    }

    // Migration ids start with a timestamp, so ids after the newest known one come from a newer build.
    const latest = input
      .map((migration) => migration.id)
      .toSorted()
      .at(-1)
    const newer = latest === undefined ? [] : [...completed].filter((id) => id > latest)
    if (newer.length > 0)
      yield* Effect.logWarning("database was migrated by a newer build", { latest, newer: newer.length })

    const pending = input.filter((migration) => !completed.has(migration.id))
    if (pending.length === 0) return
    yield* backup(db, pending[0].id)
    const timeout = (yield* db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`))?.timeout ?? 0
    yield* db.run(sql.raw(`PRAGMA busy_timeout = ${Math.max(timeout, MIGRATION_BUSY_TIMEOUT)}`))
    yield* Effect.gen(function* () {
      // A foreign key scan reads every child table, so scan once up front and then once per migration,
      // carrying each result forward as the next baseline.
      let baseline = yield* violations(db)
      for (const migration of pending) baseline = yield* run(db, migration, baseline)
    }).pipe(Effect.ensuring(db.run(sql.raw(`PRAGMA busy_timeout = ${timeout}`)).pipe(Effect.orDie)))
  })
}

// SQLite ignores `PRAGMA foreign_keys` inside a transaction, so the `PRAGMA foreign_keys=OFF` in
// generated table rebuilds would not stop DROP TABLE from cascading into child tables. Turn
// enforcement off around the transaction and check the constraints before commit instead.
// Returns the foreign key violation count after the migration, the baseline for the next one.
function run(db: Database, migration: Migration, before: number) {
  return Effect.gen(function* () {
    const foreignKeys = (yield* db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`))?.foreign_keys === 1
    yield* db.run(sql`PRAGMA foreign_keys = OFF`)
    return yield* db
      .transaction(
        (tx) =>
          Effect.gen(function* () {
            // Another process may have applied it since the journal was read, which also makes the
            // carried baseline stale.
            if (yield* tx.get(sql`SELECT id FROM ${sql.identifier("migration")} WHERE id = ${migration.id}`))
              return yield* violations(tx)
            yield* migration.up(tx)
            // Older databases may already hold orphaned rows; only fail on violations this migration adds.
            const after = yield* violations(tx)
            if (after > before)
              return yield* Effect.fail(
                new Error(`Migration ${migration.id} would leave ${after - before} foreign key violations`),
              )
            yield* tx.run(
              sql`INSERT INTO ${sql.identifier("migration")} (id, time_completed) VALUES (${migration.id}, ${Date.now()})`,
            )
            return after
          }),
        { behavior: "immediate" },
      )
      .pipe(Effect.ensuring(db.run(sql.raw(`PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"}`)).pipe(Effect.orDie)))
  })
}

function violations(db: Database | Transaction) {
  return db
    .get<{ count: number }>(sql`SELECT count(*) AS count FROM pragma_foreign_key_check`)
    .pipe(Effect.map((row) => row?.count ?? 0))
}

// opencode.db cannot be rebuilt, so snapshot it before changing its schema.
function backup(db: Database, id: string) {
  return Effect.gen(function* () {
    const file = (yield* db.all<{ name: string; file: string }>(sql`PRAGMA database_list`)).find(
      (row) => row.name === "main",
    )?.file
    // In-memory and temporary databases have no file.
    if (!file) return
    yield* Effect.promise(() => prune(file))
    const target = `${file}.pre-${id}.bak`
    // A backup from an earlier, failed attempt already holds the pre-migration state.
    if (yield* Effect.promise(() => exists(target))) return
    const temp = `${target}.${randomUUID()}.tmp`
    yield* db
      .run(sql`VACUUM INTO ${temp}`)
      .pipe(
        Effect.andThen(Effect.promise(() => keep(temp, target))),
        Effect.ensuring(Effect.promise(() => fs.rm(temp, { force: true }))),
      )
    yield* Effect.promise(() => prune(file))
  })
}

async function keep(temp: string, target: string) {
  // The backup holds the same credentials as the database.
  if (process.platform !== "win32") await fs.chmod(temp, 0o600)
  // Another process may have finished its own pre-migration backup first; either copy is valid.
  if (await exists(target)) return
  await fs.rename(temp, target)
}

// Removes backups beyond the newest few, and temp files left by a process killed mid-backup.
async function prune(file: string) {
  const dir = path.dirname(file)
  const prefix = `${path.basename(file)}.pre-`
  const names = (await fs.readdir(dir)).filter((name) => name.startsWith(prefix))
  const backups = names.filter((name) => name.endsWith(".bak")).toSorted()
  // Another process may still be writing a recent temp file.
  const stale = (
    await Promise.all(
      names
        .filter((name) => name.endsWith(".tmp"))
        .map(async (name) => {
          const stat = await fs.stat(path.join(dir, name)).catch(() => undefined)
          return stat && Date.now() - stat.mtimeMs > STALE_BACKUP_TEMP ? [name] : []
        }),
    )
  ).flat()
  await Promise.all(
    [...backups.slice(0, -BACKUPS_KEPT), ...stale].map((name) => fs.rm(path.join(dir, name), { force: true })),
  )
}

function exists(target: string) {
  return fs.access(target).then(
    () => true,
    () => false,
  )
}
