import { expect, test } from "bun:test"
import { isLocalMediaSource, stripRemoteMedia } from "./markdown-media"

function element(tagName: string, attributes: Record<string, string>) {
  const values = new Map(Object.entries(attributes))
  return {
    tagName,
    getAttribute: (name: string) => values.get(name) ?? null,
    removeAttribute: (name: string) => void values.delete(name),
    values,
  }
}

test("only data: and blob: media sources are local", () => {
  expect(isLocalMediaSource("data:image/png;base64,AAAA")).toBe(true)
  expect(isLocalMediaSource("blob:oc://renderer/123")).toBe(true)
  expect(isLocalMediaSource("https://tracker.example/pixel.gif")).toBe(false)
  expect(isLocalMediaSource("//tracker.example/pixel.gif")).toBe(false)
  expect(isLocalMediaSource("images/a.png")).toBe(false)
})

test("remote image and media sources are removed before the HTML renders", () => {
  const remote = element("IMG", { src: "https://tracker.example/p.gif", srcset: "https://x 2x", alt: "chart" })
  stripRemoteMedia(remote as unknown as Element)
  expect([...remote.values.keys()]).toEqual(["alt"])

  const inline = element("IMG", { src: "data:image/png;base64,AAAA" })
  stripRemoteMedia(inline as unknown as Element)
  expect(inline.values.get("src")).toBe("data:image/png;base64,AAAA")

  const video = element("VIDEO", { poster: "https://x/p.jpg", src: "https://x/v.mp4" })
  stripRemoteMedia(video as unknown as Element)
  expect(video.values.size).toBe(0)

  const link = element("A", { href: "https://example.com" })
  stripRemoteMedia(link as unknown as Element)
  expect(link.values.get("href")).toBe("https://example.com")
})
