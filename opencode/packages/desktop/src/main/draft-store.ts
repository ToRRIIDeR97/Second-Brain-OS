import { createHash } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import { blob, sqliteTable, text } from "drizzle-orm/sqlite-core"

const documents = sqliteTable("document", {
  key: text().primaryKey(),
  value: text().notNull(),
})
const blobs = sqliteTable("blob", {
  id: text().primaryKey(),
  data: blob({ mode: "buffer" }).notNull(),
})

// One pasted or dropped attachment. IPC has already copied a larger blob into
// main-process memory, but it is refused before it is hashed or written to
// SQLite; the renderer then keeps that attachment in memory only.
export const MAX_DRAFT_BLOB_BYTES = 64 * 1024 * 1024

export function requireDraftKey(value: unknown) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error("Invalid draft key")
}

export function requireDraftValue(value: unknown) {
  if (typeof value === "string") return value
  throw new Error("Invalid draft value")
}

export function requireDraftBlob(value: unknown) {
  if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) throw new Error("Invalid draft blob")
  if (value.byteLength > MAX_DRAFT_BLOB_BYTES) throw new Error("Draft blob too large")
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

export function createDesktopDraftStore(filename: string, onFlushError?: (error: unknown) => void) {
  const native = new DatabaseSync(filename)
  native.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS document (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blob (id TEXT PRIMARY KEY, data BLOB NOT NULL);",
  )
  const db = drizzle({ client: native })
  const used = new Set<string>()
  db.select({ value: documents.value })
    .from(documents)
    .all()
    .forEach(({ value }) =>
      JSON.parse(value, (_key, item) => {
        if (item?.blob && typeof item.blob.id === "string") used.add(item.blob.id)
        return item
      }),
    )
  db.transaction((tx) =>
    tx
      .select({ id: blobs.id })
      .from(blobs)
      .all()
      .filter(({ id }) => !used.has(id))
      .forEach(({ id }) => tx.delete(blobs).where(eq(blobs.id, id)).run()),
  )
  const pending = new Map<string, string | null>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const writes = [...pending]
    pending.clear()
    try {
      db.transaction((tx) => {
        writes.forEach(([key, value]) => {
          if (value === null) tx.delete(documents).where(eq(documents.key, key)).run()
          else
            tx.insert(documents)
              .values({ key, value })
              .onConflictDoUpdate({ target: documents.key, set: { value } })
              .run()
        })
      })
    } catch (error) {
      // A timer flush runs outside any caller, so a throw here would be
      // uncaught. Keep the failed batch, unless a newer write replaced a key,
      // and retry it with the next write or the quit flush.
      writes.forEach(([key, value]) => {
        if (!pending.has(key)) pending.set(key, value)
      })
      onFlushError?.(error)
    }
  }
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 500)
  }
  return {
    get: (key: string) =>
      pending.has(key)
        ? (pending.get(key) ?? null)
        : (db.select({ value: documents.value }).from(documents).where(eq(documents.key, key)).get()?.value ?? null),
    set(key: string, value: string | null) {
      pending.set(key, value)
      schedule()
    },
    putBlob(data: Uint8Array) {
      const id = createHash("sha256").update(data).digest("hex")
      db.insert(blobs)
        .values({ id, data: Buffer.from(data) })
        .onConflictDoNothing()
        .run()
      return id
    },
    getBlob: (id: string) => db.select({ data: blobs.data }).from(blobs).where(eq(blobs.id, id)).get()?.data ?? null,
    flush,
    close() {
      flush()
      native.close()
    },
  }
}
