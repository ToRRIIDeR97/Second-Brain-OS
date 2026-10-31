import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import {
  MAX_DRAFT_BLOB_BYTES,
  createDesktopDraftStore,
  requireDraftBlob,
  requireDraftKey,
  requireDraftValue,
} from "./draft-store.ts"

void test("flushes the latest buffered draft and stores blobs", async () => {
  const store = createDesktopDraftStore(":memory:")
  store.set("prompt", "first")
  store.set("prompt", "latest")
  assert.equal(store.get("prompt"), "latest")
  store.flush()
  assert.equal(store.get("prompt"), "latest")

  const bytes = new TextEncoder().encode("image")
  const id = await store.putBlob(bytes)
  assert.deepEqual(new Uint8Array(store.getBlob(id)!), bytes)
  assert.equal(id, createHash("sha256").update(bytes).digest("hex"))
  assert.equal(await store.putBlob(bytes), id)
  store.close()
})

void test("keeps a failed flush batch for the next attempt", () => {
  const dir = mkdtempSync(join(tmpdir(), "draft-store-"))
  const filename = join(dir, "drafts.sqlite")
  const errors: unknown[] = []
  const store = createDesktopDraftStore(filename, (error) => errors.push(error))
  const other = new DatabaseSync(filename)
  other.exec("DROP TABLE document")

  store.set("prompt", "kept")
  store.set("stale", "old")
  assert.doesNotThrow(() => store.flush())
  assert.equal(errors.length, 1)
  assert.equal(store.get("prompt"), "kept")

  other.exec("CREATE TABLE document (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  store.set("stale", "new")
  store.flush()
  assert.deepEqual(
    other
      .prepare("SELECT key, value FROM document ORDER BY key")
      .all()
      .map((row) => ({ ...row })),
    [
      { key: "prompt", value: "kept" },
      { key: "stale", value: "new" },
    ],
  )
  other.close()
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

void test("removes unreferenced blobs on open", async () => {
  const dir = mkdtempSync(join(tmpdir(), "draft-store-"))
  const filename = join(dir, "drafts.sqlite")
  const first = createDesktopDraftStore(filename)
  const kept = await first.putBlob(new TextEncoder().encode("kept"))
  const orphan = await first.putBlob(new TextEncoder().encode("orphan"))
  const another = await first.putBlob(new TextEncoder().encode("another orphan"))
  first.set("prompt", JSON.stringify([{ type: "image", blob: { id: kept } }]))
  first.close()

  const second = createDesktopDraftStore(filename)
  assert.notEqual(second.getBlob(kept), null)
  assert.equal(second.getBlob(orphan), null)
  assert.equal(second.getBlob(another), null)
  second.close()
  rmSync(dir, { recursive: true, force: true })
})

void test("validates renderer draft input", () => {
  assert.equal(requireDraftKey("prompt"), "prompt")
  assert.throws(() => requireDraftKey(""), /Invalid draft key/)
  assert.throws(() => requireDraftKey(1), /Invalid draft key/)
  assert.equal(requireDraftValue(""), "")
  assert.throws(() => requireDraftValue(null), /Invalid draft value/)
  assert.throws(() => requireDraftValue({}), /Invalid draft value/)
  assert.deepEqual(requireDraftBlob(new Uint8Array([1, 2]).buffer), new Uint8Array([1, 2]))
  assert.deepEqual(requireDraftBlob(new Uint8Array([3])), new Uint8Array([3]))
  assert.throws(() => requireDraftBlob("data"), /Invalid draft blob/)
  assert.throws(() => requireDraftBlob(new ArrayBuffer(MAX_DRAFT_BLOB_BYTES + 1)), /Draft blob too large/)
})

void test("keeps the draft files readable by the owner only", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "draft-store-"))
  const filename = join(dir, "drafts.sqlite")
  const store = createDesktopDraftStore(filename)
  store.set("prompt", "private")
  store.flush()
  for (const file of [filename, `${filename}-wal`]) assert.equal(statSync(file).mode & 0o777, 0o600)
  store.close()
  rmSync(dir, { recursive: true, force: true })
})
