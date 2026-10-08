// Functional-test (verify) checks for the harness setup assistant.
// Core: from opencode/packages/core
//   bun test ../../../Implementations/harness-setup-assistant/acceptance/verify.test.ts -t core
// Route: from opencode/packages/opencode
//   bun test --timeout 30000 ../../../Implementations/harness-setup-assistant/acceptance/verify.test.ts -t route
import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { Effect, Exit, Scope } from "effect";
import { LayerNode } from "../../../opencode/packages/core/src/effect/layer-node";
import { AppProcess } from "../../../opencode/packages/core/src/process";
import { HarnessRegistry } from "../../../opencode/packages/core/src/harness/registry";

// Reuses the deterministic agent from the settings-page package: every prompt replies `model:<current>`.
const fixture = path.resolve(
  import.meta.dir,
  "../../harness-settings-page/fixtures/fake-acp-agent.ts",
);
const layer = LayerNode.compile(AppProcess.node);
const runExit = <A, E>(
  effect: Effect.Effect<A, E, AppProcess.Service | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.exit(effect).pipe(
      Effect.scoped,
      Effect.provide(layer),
    ) as Effect.Effect<Exit.Exit<A, E>, never, never>,
  );
const verify = (input: Record<string, unknown>) =>
  runExit(
    Effect.gen(function* () {
      const proc = yield* AppProcess.Service;
      return yield* HarnessRegistry.verify(input, {
        directory: os.tmpdir(),
        process: proc,
      });
    }),
  );

describe("harness verify core", () => {
  test("a working agent answers the test prompt with the requested model", async () => {
    const exit = await verify({
      command: process.execPath,
      args: [fixture, "config-options"],
      model: "fake-b",
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    if (!Exit.isSuccess(exit)) return;
    expect(exit.value).toMatchObject({
      ok: true,
      reply: "model:fake-b",
      agentName: "Fake ACP",
      version: "9.9.9",
    });
    expect(exit.value.models.map((model) => model.id)).toEqual([
      "fake-a",
      "fake-b",
    ]);
  });

  test("without a model the agent's current model answers", async () => {
    const exit = await verify({
      command: process.execPath,
      args: [fixture, "models"],
    });
    expect(Exit.isSuccess(exit) && exit.value.reply).toBe("model:fake-a");
  });

  test("a command that does not speak ACP fails with probe-failed", async () => {
    const exit = await verify({
      command: process.execPath,
      args: [fixture, "not-acp"],
    });
    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit)
      ? (
          exit.cause.reasons.find((reason) => reason._tag === "Fail") as {
            error?: { reason?: string };
          }
        )?.error
      : undefined;
    expect(error?.reason).toBe("probe-failed");
  });

  test("a missing command fails with command-not-found", async () => {
    const exit = await verify({ command: "definitely-not-an-acp-agent-xyz" });
    const error = Exit.isFailure(exit)
      ? (
          exit.cause.reasons.find((reason) => reason._tag === "Fail") as {
            error?: { reason?: string };
          }
        )?.error
      : undefined;
    expect(error?.reason).toBe("command-not-found");
  });
});

describe("harness verify route", () => {
  afterEach(async () => {
    const { disposeAllInstances } = await import(
      "../../../opencode/packages/opencode/test/fixture/fixture"
    );
    const { resetDatabase } = await import(
      "../../../opencode/packages/opencode/test/fixture/db"
    );
    await disposeAllInstances();
    await resetDatabase();
  });

  test("POST /api/harness/verify returns the reply and models", async () => {
    const { Context } = await import("effect");
    const { HttpApiApp } = await import(
      "../../../opencode/packages/opencode/src/server/routes/instance/httpapi/server"
    );
    const { tmpdir } = await import(
      "../../../opencode/packages/opencode/test/fixture/fixture"
    );
    await using dir = await tmpdir({ git: true });
    const url = new URL("http://localhost/api/harness/verify");
    url.searchParams.set("location[directory]", dir.path);
    const response = await HttpApiApp.webHandler().handler(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command: process.execPath,
          args: [fixture, "models"],
          model: "fake-b",
        }),
      }),
      Context.empty() as never,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ ok: true, reply: "model:fake-b" });
  });
});
