import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createDeepLinkQueue, parseDeepLink } from "./deep-links"

const exists = (directory: string) => directory === "/work/repo"
const link = (host: string, params: Record<string, string>) =>
  `tenon://${host}?${new URLSearchParams(params).toString()}`

test("accepts only existing absolute local folders and rebuilds the link", () => {
  expect(parseDeepLink(link("open-project", { directory: "/work/repo", extra: "x" }), exists)).toEqual({
    kind: "open-project",
    directory: "/work/repo",
    url: "tenon://open-project?directory=%2Fwork%2Frepo",
  })
  expect(parseDeepLink(link("new-session", { directory: "/work/repo", prompt: "hi" }), exists)).toMatchObject({
    kind: "new-session",
    directory: "/work/repo",
    prompt: "hi",
  })
})

test("refuses UNC, protocol-relative, file:, relative, traversal and missing folders", () => {
  for (const directory of [
    "\\\\host\\share",
    "//host/x",
    "file:///work/repo",
    "../x",
    "work/repo",
    "/work/repo/../repo",
    "/work/missing",
  ]) {
    expect(parseDeepLink(link("open-project", { directory }), (value) => value !== "/work/missing")).toBeUndefined()
  }
})

test("refuses other hosts, schemes and links without a folder", () => {
  expect(parseDeepLink(link("run-command", { directory: "/work/repo" }), exists)).toBeUndefined()
  expect(parseDeepLink("opencode://open-project?directory=%2Fwork%2Frepo", exists)).toBeUndefined()
  expect(parseDeepLink("tenon://open-project", exists)).toBeUndefined()
  expect(parseDeepLink("not a url", exists)).toBeUndefined()
})

test("checks the folder on disk", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "deep-link-"))
  const onDisk = (value: string) => existsSync(value) && statSync(value).isDirectory()
  try {
    expect(parseDeepLink(link("open-project", { directory }), onDisk)?.directory).toBe(directory)
    expect(parseDeepLink(link("open-project", { directory: path.join(directory, "nope") }), onDisk)).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

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
