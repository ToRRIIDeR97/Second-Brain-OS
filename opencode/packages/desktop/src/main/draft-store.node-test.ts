import assert from "node:assert/strict"
import { test } from "node:test"
import { createDesktopDraftStore } from "./draft-store.ts"

test("flushes the latest buffered draft and stores blobs", () => {
  const store = createDesktopDraftStore(":memory:")
  store.set("prompt", "first")
  store.set("prompt", "latest")
  assert.equal(store.get("prompt"), "latest")
  store.flush()
  assert.equal(store.get("prompt"), "latest")

  const bytes = new TextEncoder().encode("image")
  const id = store.putBlob(bytes)
  assert.deepEqual(new Uint8Array(store.getBlob(id)!), bytes)
  store.close()
})
