import { describe, expect, test } from "bun:test"
import { QueuedActionsUnsupportedError } from "@/utils/server-compat"
import { createQueuedActions } from "./queued-actions"

function setup(remove: (messageID: string) => Promise<void>) {
  const calls: string[] = []
  const errors: unknown[] = []
  let unsupported = 0
  const actions = createQueuedActions({
    remove: (messageID) => {
      calls.push(`remove:${messageID}`)
      return remove(messageID)
    },
    send: async (messageID) => {
      calls.push(`send:${messageID}`)
    },
    onError: (error) => errors.push(error),
    onUnsupported: () => unsupported++,
  })
  return { actions, calls, errors, unsupported: () => unsupported }
}

describe("createQueuedActions", () => {
  test("marks one item pending and ignores other actions until it settles", async () => {
    const pending = Promise.withResolvers<void>()
    const ctx = setup(() => pending.promise)

    const first = ctx.actions.remove("msg_1")
    expect(ctx.actions.state.pending).toBe("msg_1")
    await ctx.actions.send("msg_2")
    expect(ctx.calls).toEqual(["remove:msg_1"])

    pending.resolve()
    await first
    expect(ctx.actions.state.pending).toBeUndefined()
    await ctx.actions.send("msg_2")
    expect(ctx.calls).toEqual(["remove:msg_1", "send:msg_2"])
  })

  test("reports failures and clears the pending state", async () => {
    const failure = new Error("Queued message already started: msg_1")
    const ctx = setup(() => Promise.reject(failure))

    await ctx.actions.remove("msg_1")

    expect(ctx.errors).toEqual([failure])
    expect(ctx.actions.state).toEqual({ pending: undefined, unsupported: false })
  })

  test("hides the actions once the server reports them unsupported", async () => {
    const ctx = setup(() => Promise.reject(new QueuedActionsUnsupportedError()))

    await ctx.actions.remove("msg_1")
    await ctx.actions.send("msg_1")

    expect(ctx.unsupported()).toBe(1)
    expect(ctx.errors).toEqual([])
    expect(ctx.actions.state.unsupported).toBe(true)
    expect(ctx.calls).toEqual(["remove:msg_1"])
  })
})
