import { createStore } from "solid-js/store"
import { QueuedActionsUnsupportedError } from "@/utils/server-compat"

// Pending and support state for the follow-up dock's Remove and Send now actions. One action runs at a
// time. The server's withdrawn or steered event, not this state, drops the item from the dock.
export function createQueuedActions(input: {
  remove: (messageID: string) => Promise<void>
  send: (messageID: string) => Promise<void>
  onError: (error: unknown) => void
  onUnsupported: () => void
}) {
  const [state, setState] = createStore({ pending: undefined as string | undefined, unsupported: false })
  const run = (action: (messageID: string) => Promise<void>, messageID: string) => {
    if (state.pending || state.unsupported) return Promise.resolve()
    setState("pending", messageID)
    return action(messageID)
      .catch((error: unknown) => {
        if (!(error instanceof QueuedActionsUnsupportedError)) return input.onError(error)
        setState("unsupported", true)
        input.onUnsupported()
      })
      .finally(() => setState("pending", undefined))
  }
  return {
    state,
    remove: (messageID: string) => run(input.remove, messageID),
    send: (messageID: string) => run(input.send, messageID),
  }
}
