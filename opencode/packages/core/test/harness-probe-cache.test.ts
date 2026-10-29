import { describe, expect, test } from "bun:test"
import { Deferred, Effect } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Harness } from "@opencode-ai/schema/harness"
import { HarnessRuntime } from "@opencode-ai/core/harness"
import { HarnessCatalogCache } from "@opencode-ai/core/harness/catalog-cache"

const instance = (status: "available" | "unavailable", error?: string): Harness.Instance => ({
  id: Harness.InstanceID.make("command-code"),
  driver: Harness.DriverKind.make("acp"),
  name: "Command Code",
  status,
  models: [],
  ...(error ? { error } : {}),
})
const config = { id: Harness.InstanceID.make("command-code"), driver: Harness.DriverKind.make("acp") }

const setup = (stored: Map<string, Harness.Instance>) =>
  Effect.gen(function* () {
    const persisted: Harness.Instance[] = []
    const probes = new Map<string, { readonly expires: number; readonly instance: Harness.Instance }>()
    const cachedProbe = HarnessRuntime.makeCachedProbe({
      catalogs: new Map(),
      probes,
      stored,
      setCatalog: () => Effect.void,
      persist: (_key, value) => Effect.sync(() => void persisted.push(value)),
      scope: yield* Effect.scope,
    })
    return { cachedProbe, persisted, probes }
  })

describe("harness probe cache", () => {
  test("answers with the last run's check at once and refreshes it in the background", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ctx = yield* setup(new Map([["key", instance("available")]]))
          const release = yield* Deferred.make<void>()
          // A slow check (Command Code takes about 5s) that fails once released.
          const slow = () => Deferred.await(release).pipe(Effect.as({ instance: instance("unavailable") }))

          // The check is still blocked on `release`, so waiting for it here would hang the test.
          expect((yield* ctx.cachedProbe("key", config, slow)).status).toBe("available")
          // A second listing during the background check gets the stored result too, without a new check.
          expect((yield* ctx.cachedProbe("key", config, slow)).status).toBe("available")
          expect(ctx.persisted).toEqual([])

          yield* Deferred.succeed(release, undefined)
          while (!ctx.probes.has("key")) yield* Effect.yieldNow
          // The failed check replaces the stored one, for this run and the next start.
          expect(ctx.persisted.map((item) => item.status)).toEqual(["unavailable"])
          expect((yield* ctx.cachedProbe("key", config, slow)).status).toBe("unavailable")
        }),
      ),
    )
  })

  test("waits for the check when nothing is stored", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const ctx = yield* setup(new Map())
          return yield* ctx.cachedProbe("key", config, () => Effect.succeed({ instance: instance("available") }))
        }),
      ),
    )
    expect(result.status).toBe("available")
  })

  test("stores checks without their CLI error text and ignores a corrupt file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-probes-"))
    await Effect.runPromise(HarnessCatalogCache.writeProbe(dir, "key", instance("unavailable", "boom at C:\\Users\\x")))
    expect(await Effect.runPromise(HarnessCatalogCache.readProbes(dir))).toEqual({
      [HarnessCatalogCache.id("key")]: instance("unavailable"),
    })
    await fs.writeFile(path.join(dir, HarnessCatalogCache.probeFileName), "{oops")
    expect(await Effect.runPromise(HarnessCatalogCache.readProbes(dir))).toEqual({})
  })
})
