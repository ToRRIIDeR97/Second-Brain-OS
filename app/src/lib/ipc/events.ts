import { listen as tauriListen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import type { EventEnvelope } from "./types";

export type Unsubscribe = () => void;
export type ListenPort = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<Unsubscribe>;

const tauriListenPort: ListenPort = (event, handler) =>
  tauriListen<unknown>(event, handler);

export function createEventClient(listen: ListenPort = tauriListenPort) {
  return {
    subscribe<T>(event: string, handler: (payload: EventEnvelope<T>) => void) {
      return listen(event, ({ payload }) => {
        handler(payload as EventEnvelope<T>);
      });
    },
  };
}

export const eventClient = createEventClient();
export type EventClient = ReturnType<typeof createEventClient>;

/** Subscribe from a view and guarantee cleanup if the async listener resolves late. */
export function useIpcEvent<T>(
  event: string,
  handler: (payload: EventEnvelope<T>) => void,
  source: EventClient = eventClient,
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(() => {
    let mounted = true;
    let unsubscribe: Unsubscribe | undefined;
    void source
      .subscribe<T>(event, (payload) => {
        if (mounted) handlerRef.current(payload);
      })
      .then((cleanup) => {
        if (mounted) unsubscribe = cleanup;
        else cleanup();
      });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [event, source]);
}
