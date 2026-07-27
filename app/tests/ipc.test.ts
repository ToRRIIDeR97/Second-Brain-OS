import { createMockIpc } from "../src/lib/ipc/mock";

test("validates typed command envelopes and records correlation IDs", async () => {
  const mock = createMockIpc();
  const result = await mock.client.system.ping();
  expect(result).toEqual({
    contract: "ipc_result",
    version: 1,
    ok: true,
    data: "pong",
    correlationId: "mock-correlation",
  });
  expect(mock.calls[0]?.command).toBe("system_ping");
});

test("stream subscriptions return an unsubscribe function", async () => {
  const mock = createMockIpc();
  const seen: string[] = [];
  const unsubscribe = await mock.events.subscribe<{ message: string }>(
    "job.progress",
    (event) => seen.push(event.data.message),
  );
  expect(mock.listenerCount("job.progress")).toBe(1);
  mock.emit("job.progress", {
    schemaVersion: 1,
    event: "job.progress",
    correlationId: "c-1",
    data: { message: "halfway" },
  });
  expect(seen).toEqual(["halfway"]);
  unsubscribe();
  expect(mock.listenerCount("job.progress")).toBe(0);
});

test("malformed command responses become stable typed errors", async () => {
  const mock = createMockIpc();
  mock.setResponse("system_ping", {
    contract: "ipc_result",
    version: 1,
    ok: true,
    correlationId: "bad",
  });
  const result = await mock.client.system.ping();
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("IPC_MALFORMED_ENVELOPE");
});
