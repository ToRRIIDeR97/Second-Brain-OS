import { describe, expect, test } from "bun:test"
import { createUndoQueue, type UndoAction } from "./undo-action"

function setup() {
  const timers = new Map<number, () => void>()
  const shown: Array<{ id: number; undo: () => void }> = []
  const dismissed: number[] = []
  const errors: unknown[] = []
  let next = 0
  const queue = createUndoQueue({
    duration: 5000,
    show: (_action, undo) => {
      const id = ++next
      shown.push({ id, undo })
      return id
    },
    dismiss: (id) => dismissed.push(id),
    onError: (cause) => errors.push(cause),
    schedule: (run) => {
      const id = ++next
      timers.set(id, run)
      return () => timers.delete(id)
    },
  })
  const expire = () => [...timers.values()].forEach((run) => run())
  return { queue, shown, dismissed, errors, expire, timers }
}

const action = (log: string[], name: string): UndoAction => ({
  title: name,
  undo: () => log.push(`undo ${name}`),
  commit: () => log.push(`commit ${name}`),
})

describe("undo queue", () => {
  test("commits when the window expires and dismisses the toast", () => {
    const { queue, dismissed, expire } = setup()
    const log: string[] = []
    queue.push(action(log, "a"))
    expect(queue.pending()).toBe(1)
    expire()
    expect(log).toEqual(["commit a"])
    expect(dismissed).toEqual([1])
    expect(queue.pending()).toBe(0)
    expect(queue.undoLatest()).toBe(false)
  })

  test("undoLatest undoes the most recent action only, and cancels its commit", () => {
    const { queue, expire } = setup()
    const log: string[] = []
    queue.push(action(log, "a"))
    queue.push(action(log, "b"))
    expect(queue.undoLatest()).toBe(true)
    expect(log).toEqual(["undo b"])
    expire()
    expect(log).toEqual(["undo b", "commit a"])
  })

  test("the toast's undo button settles once", () => {
    const { queue, shown, expire } = setup()
    const log: string[] = []
    queue.push(action(log, "a"))
    shown[0]!.undo()
    shown[0]!.undo()
    expire()
    expect(log).toEqual(["undo a"])
  })

  test("flush commits everything pending", () => {
    const { queue } = setup()
    const log: string[] = []
    queue.push(action(log, "a"))
    queue.push(action(log, "b"))
    queue.flush()
    expect(log).toEqual(["commit a", "commit b"])
  })

  test("reports sync and async failures", async () => {
    const { queue, errors } = setup()
    queue.push({
      title: "x",
      undo: () => {
        throw new Error("sync")
      },
    })
    queue.push({ title: "y", undo: () => Promise.reject(new Error("async")) })
    queue.undoLatest()
    queue.undoLatest()
    await Promise.resolve()
    await Promise.resolve()
    expect(errors.map((cause) => (cause as Error).message).sort()).toEqual(["async", "sync"])
  })
})
