import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Effect } from "effect"
import { Installation } from "../../src/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Installation.node))

describe("installation", () => {
  it.effect("reports the bundled version without checking for releases", () =>
    Effect.gen(function* () {
      expect(yield* Installation.use.method()).toBe("unknown")
      expect(yield* Installation.use.latest("curl")).toBe(InstallationVersion)
      expect(yield* Installation.use.info()).toEqual({ version: InstallationVersion, latest: InstallationVersion })
    }),
  )

  it.effect("refuses to upgrade outside the desktop updater", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Installation.use.upgrade("curl", "9.9.9"))
      expect(error).toBeInstanceOf(Installation.UpgradeFailedError)
      expect(error.message).toBe("Updates are managed by the desktop app.")
    }),
  )
})
