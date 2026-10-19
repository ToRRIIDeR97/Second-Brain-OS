import { describe, expect, test } from "bun:test"
import { restartDelay, superviseSidecar } from "./sidecar-supervisor"

function fakeSidecar() {
  const ready = Promise.withResolvers<void>()
  const exited = Promise.withResolvers<number>()
  ready.promise.catch(() => undefined)
  return {
    ready: ready.promise,
    exited: exited.promise,
    stopped: false,
    start: () => ready.resolve(),
    fail: (error: Error) => ready.reject(error),
    crash: (code = 1) => exited.resolve(code),
    stop() {
      this.stopped = true
      exited.resolve(0)
      return Promise.resolve()
    },
  }
}

function setup(clock = { now: 0 }) {
  const spawned: ReturnType<typeof fakeSidecar>[] = []
  const delays: number[] = []
  const logs: string[] = []
  const supervisor = superviseSidecar({
    spawn: () => {
      const sidecar = fakeSidecar()
      spawned.push(sidecar)
      return sidecar
    },
    log: (message) => logs.push(message),
    sleep: async (ms) => {
      delays.push(ms)
      clock.now += ms
    },
    now: () => clock.now,
  })
  return { supervisor, spawned, delays, logs, clock }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("sidecar supervisor", () => {
  test("backs off exponentially up to the cap", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(restartDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
  })

  test("restarts a sidecar that exits after it became ready", async () => {
    const { spawned, delays } = setup()
    spawned[0].start()
    await flush()
    spawned[0].crash()
    await flush()
    expect(spawned).toHaveLength(2)
    expect(delays).toEqual([1_000])
  })

  test("leaves a failed first start to the caller", async () => {
    const { spawned } = setup()
    spawned[0].fail(new Error("boom"))
    await flush()
    expect(spawned).toHaveLength(1)
  })

  test("retries failed restarts with growing delays and stops at the limit", async () => {
    const { spawned, delays, logs } = setup()
    spawned[0].start()
    await flush()
    spawned[0].crash()
    for (let i = 0; i < 10; i++) {
      await flush()
      spawned.at(-1)!.fail(new Error("still broken"))
    }
    await flush()
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000])
    expect(spawned).toHaveLength(6)
    expect(logs).toContain("sidecar restart limit reached")
  })

  test("forgets restarts outside the window", async () => {
    const { spawned, delays, clock } = setup()
    spawned[0].start()
    for (let i = 0; i < 3; i++) {
      await flush()
      spawned.at(-1)!.start()
      await flush()
      clock.now += 60 * 60_000
      spawned.at(-1)!.crash()
    }
    await flush()
    expect(delays).toEqual([1_000, 1_000, 1_000])
  })

  test("does not restart after stop", async () => {
    const { supervisor, spawned } = setup()
    spawned[0].start()
    await flush()
    await supervisor.stop()
    await flush()
    expect(spawned[0].stopped).toBe(true)
    expect(spawned).toHaveLength(1)
  })

  test("stop reaches the restarted sidecar", async () => {
    const { supervisor, spawned } = setup()
    spawned[0].start()
    await flush()
    spawned[0].crash()
    await flush()
    await supervisor.stop()
    expect(spawned[1].stopped).toBe(true)
  })
})
