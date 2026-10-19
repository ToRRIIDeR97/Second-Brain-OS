import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildEnv } from "@opencode-ai/core/child-env"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppProcess } from "@opencode-ai/core/process"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(AppProcess.node))

const printEnv = (env?: Record<string, string>) =>
  ChildProcess.make(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify([process.env.OPENCODE_SERVER_PASSWORD, process.env.OPENCODE_SERVER_USERNAME, process.env.CHILD_ENV_TEST_KEEP]))",
    ],
    env ? { env, extendEnv: true } : {},
  )

// Sets the server credentials in this process's environment for the duration of one test.
const withServerCredentials = Effect.acquireRelease(
  Effect.sync(() => {
    const original = { ...process.env }
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    process.env.OPENCODE_SERVER_USERNAME = "opencode"
    process.env.CHILD_ENV_TEST_KEEP = "kept"
    return original
  }),
  (original) =>
    Effect.sync(() => {
      for (const name of ["OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME", "CHILD_ENV_TEST_KEEP"]) {
        if (original[name] === undefined) delete process.env[name]
        else process.env[name] = original[name]
      }
    }),
)

describe("ChildEnv.from", () => {
  it.effect(
    "removes only the server credentials",
    Effect.sync(() => {
      expect(
        ChildEnv.from({
          PATH: "/usr/bin",
          OPENCODE_SERVER_PASSWORD: "secret",
          opencode_server_username: "opencode",
          OPENAI_API_KEY: "user-key",
        }),
      ).toEqual({ PATH: "/usr/bin", OPENAI_API_KEY: "user-key" })
    }),
  )
})

describe("CrossSpawnSpawner", () => {
  it.live(
    "does not pass the server credentials to inheriting children",
    Effect.gen(function* () {
      yield* withServerCredentials
      const svc = yield* AppProcess.Service
      const inherited = yield* svc.run(printEnv())
      expect(JSON.parse(inherited.stdout.toString("utf8"))).toEqual([null, null, "kept"])
      const extended = yield* svc.run(printEnv({ EXTRA: "1" }))
      expect(JSON.parse(extended.stdout.toString("utf8"))).toEqual([null, null, "kept"])
    }),
  )
})
