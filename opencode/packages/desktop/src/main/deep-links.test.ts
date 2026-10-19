import { expect, test } from "bun:test"
import { createDeepLinkQueue } from "./deep-links"

const target = (id: number, received: string[][]) => ({ id, send: (urls: string[]) => received.push(urls) })

test("queues deep links until a renderer consumes them", () => {
  const queue = createDeepLinkQueue()
  const received: string[][] = []
  queue.emit(["tenon://a"], target(1, received))
  expect(received).toEqual([])
  expect(queue.consume(1)).toEqual(["tenon://a"])
  expect(queue.consume(2)).toEqual([])
})

test("does not replay delivered deep links in new windows or after a reload", () => {
  const queue = createDeepLinkQueue()
  const received: string[][] = []
  queue.consume(1)
  queue.emit(["tenon://a"], target(1, received))
  expect(received).toEqual([["tenon://a"]])
  expect(queue.consume(2)).toEqual([])

  queue.forget(1)
  queue.emit(["tenon://b"], target(1, received))
  expect(received).toEqual([["tenon://a"]])
  expect(queue.consume(1)).toEqual(["tenon://b"])
})

test("queues deep links when no window is open", () => {
  const queue = createDeepLinkQueue()
  queue.emit(["tenon://a"])
  queue.emit([])
  expect(queue.consume(1)).toEqual(["tenon://a"])
})
