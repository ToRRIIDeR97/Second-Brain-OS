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
    const data =
      command === "system_ping"
        ? "pong"
        : command === "workspace_list"
          ? []
          : command === "workspace_list_directory"
            ? { entries: [] }
            : command === "file_create_attachment"
              ? {
                  path: (args?.request as { path?: unknown } | undefined)?.path,
                  mediaType: "image/png",
                  sizeBytes: 0,
                }
              : command === "file_read_attachment"
                ? { base64: "", mediaType: "image/png", sizeBytes: 0 }
                : command === "git_status"
                  ? { changes: [] }
                  : command === "git_diff"
                    ? {
                        staged: Boolean(args?.staged),
                        patch: "",
                        truncated: false,
                      }
                    : command === "git_file_diff"
                      ? {
                          path: typeof args?.path === "string" ? args.path : "",
                          kind: args?.staged === true ? "staged" : "unstaged",
                          staged: Boolean(args?.staged),
                          original: "",
                          modified: "",
                          originalLabel: "HEAD",
                          modifiedLabel: "Working tree",
                          binary: false,
                          oversized: false,
                        }
                      : command === "language_tools_status" ||
                          command === "language_analyze"
                        ? []
                        : (args?.layout ?? null);
    return Promise.resolve({
      contract: "ipc_result",
      version: 1,
      ok: true,
      data,
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
