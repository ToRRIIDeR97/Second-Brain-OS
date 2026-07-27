import type { EventEnvelope } from "./types";
import { createEventClient, type ListenPort, type Unsubscribe } from "./events";
import { createIpcClient, type InvokePort } from "./client";

export function createMockIpc() {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const handlers = new Map<string, unknown>();
  const subscriptions = new Map<string, Set<(payload: unknown) => void>>();

  const invoke: InvokePort = <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    calls.push(args === undefined ? { command } : { command, args });
    const handler = handlers.get(command);
    if (typeof handler === "function")
      return Promise.resolve((handler as () => T)());
    return Promise.resolve({
      contract: "ipc_result",
      version: 1,
      ok: true,
      data: command === "system_ping" ? "pong" : (args?.layout ?? null),
      correlationId: "mock-correlation",
    } as T);
  };

  const listen: ListenPort = (event, handler) => {
    const listeners = subscriptions.get(event) ?? new Set();
    subscriptions.set(event, listeners);
    const callback = (payload: unknown) => {
      handler({ payload });
    };
    listeners.add(callback);
    return Promise.resolve(() => {
      listeners.delete(callback);
    });
  };

  return {
    client: createIpcClient(invoke),
    events: createEventClient(listen),
    calls,
    setResponse(command: string, response: unknown) {
      handlers.set(command, () => response);
    },
    emit<T>(event: string, payload: EventEnvelope<T>) {
      subscriptions.get(event)?.forEach((listener) => {
        listener(payload);
      });
    },
    listenerCount(event: string) {
      return subscriptions.get(event)?.size ?? 0;
    },
  };
}

export type MockIpc = ReturnType<typeof createMockIpc>;
export type MockUnsubscribe = Unsubscribe;
