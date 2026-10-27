import { describe, expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import {
  collectDesigns,
  DESIGN_CSP,
  designDocument,
  designFences,
  designID,
  designInfo,
  designTooLarge,
  isDesignInfo,
  MAX_DESIGN_BYTES,
} from "./design-fence"

describe("designInfo", () => {
  test("reads a plain html block", () => {
    expect(designInfo("html")).toEqual({ title: undefined, canvas: false })
    expect(isDesignInfo("html")).toBe(true)
    expect(isDesignInfo(" html canvas")).toBe(true)
    expect(isDesignInfo("htmlbars")).toBe(false)
    expect(isDesignInfo("xml html")).toBe(false)
  })

  test("reads canvas and quoted titles", () => {
    expect(designInfo('html canvas title="Landing page"')).toEqual({ title: "Landing page", canvas: true })
    expect(designInfo("html title='Pricing card'")).toEqual({ title: "Pricing card", canvas: false })
    expect(designInfo("html title=Hero canvas")).toEqual({ title: "Hero", canvas: true })
    expect(designInfo('html  CANVAS   title="A"')).toEqual({ title: "A", canvas: true })
  })

  test("only a standalone canvas word makes a canvas block", () => {
    expect(designInfo('html title="canvas ideas"').canvas).toBe(false)
    expect(designInfo("html canvases").canvas).toBe(false)
  })

  test("handles escaped quotes, empty and unterminated titles", () => {
    expect(designInfo('html title="Say \\"hi\\""').title).toBe('Say "hi"')
    expect(designInfo('html title=""').title).toBeUndefined()
    expect(designInfo('html title="   "').title).toBeUndefined()
    expect(designInfo('html title="Open').title).toBe('"Open')
  })

  test("strips control characters and caps the length", () => {
    expect(designInfo('html title="a\u0007b"').title).toBe("ab")
    expect(designInfo(`html title="${"x".repeat(500)}"`).title).toHaveLength(120)
  })
})

describe("designFences", () => {
  test("finds closed and streaming html fences in order", () => {
    const text = [
      "Intro",
      "```html",
      "<p>small</p>",
      "```",
      "```ts",
      "const a = 1",
      "```",
      '```html canvas title="Board"',
      "<main>",
      "  <h1>Hi</h1>",
    ].join("\n")
    expect(designFences(text)).toEqual([
      { title: undefined, canvas: false, source: "<p>small</p>", closed: true },
      { title: "Board", canvas: true, source: "<main>\n  <h1>Hi</h1>", closed: false },
    ])
  })

  test("ignores html fences nested inside other fences and inline triple backticks", () => {
    const text = ["````md", "```html", "<p>x</p>", "```", "````", "```html``` is inline"].join("\n")
    expect(designFences(text)).toEqual([])
  })

  test("needs a closing fence at least as long and of the same character", () => {
    const text = ["````html", "```", "~~~~", "<p>x</p>", "````"].join("\n")
    expect(designFences(text)).toEqual([
      { title: undefined, canvas: false, source: "```\n~~~~\n<p>x</p>", closed: true },
    ])
  })

  test("removes the fence indentation from the body", () => {
    expect(designFences("  ```html\n    <b>x</b>\n  ```")[0]?.source).toBe("  <b>x</b>")
  })
})

describe("designDocument", () => {
  test("puts the CSP first in the head", () => {
    const doc = designDocument("<!doctype html><html><head><title>x</title></head><body>hi</body></html>")
    expect(
      doc.startsWith(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${DESIGN_CSP}">`),
    ).toBe(true)
    expect(DESIGN_CSP).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:",
    )
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<title>"))
    expect(doc).not.toContain("postMessage")
  })

  test("turns off DNS prefetch and WebRTC before any page content", () => {
    const doc = designDocument("<script>new RTCPeerConnection()</script>", { autosize: true })
    const prefetch = doc.indexOf('<meta http-equiv="x-dns-prefetch-control" content="off">')
    const guard = doc.indexOf("<script>")
    const guardEnd = doc.indexOf("</script>", guard)
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(prefetch)
    expect(prefetch).toBeLessThan(guard)
    expect(guardEnd).toBeLessThan(doc.indexOf("parent.postMessage"))
    expect(guardEnd).toBeLessThan(doc.indexOf("new RTCPeerConnection"))
    const script = doc.slice(guard + "<script>".length, guardEnd)
    for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"])
      expect(script).toContain(`"${name}"`)
  })

  test("the WebRTC guard removes the constructors for good", () => {
    const doc = designDocument("")
    const script = doc.slice(doc.indexOf("<script>") + "<script>".length, doc.indexOf("</script>"))
    const connect = () => "connected"
    const frame: Record<string, unknown> = { RTCPeerConnection: connect, RTCDataChannel: connect }
    runInNewContext(script, { window: frame })
    expect(frame.RTCPeerConnection).toBeUndefined()
    expect(frame.webkitRTCPeerConnection).toBeUndefined()
    expect(frame.RTCDataChannel).toBeUndefined()
    // Modules are strict, so writing a non-writable property throws.
    expect(() => {
      frame.RTCPeerConnection = connect
    }).toThrow()
    expect(() => Object.defineProperty(frame, "RTCPeerConnection", { value: connect })).toThrow()
    expect(frame.RTCPeerConnection).toBeUndefined()
  })

  test("adds the height reporter only when asked", () => {
    const doc = designDocument("<p>x</p>", { autosize: true })
    expect(doc).toContain("parent.postMessage(h,'*')")
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<script>"))
    expect(doc.endsWith("<p>x</p>")).toBe(true)
  })
})

describe("designTooLarge", () => {
  test("caps the UTF-8 size", () => {
    expect(designTooLarge("x".repeat(MAX_DESIGN_BYTES))).toBe(false)
    expect(designTooLarge("x".repeat(MAX_DESIGN_BYTES + 1))).toBe(true)
    // Three bytes per character in UTF-8.
    expect(designTooLarge("€".repeat(Math.ceil(MAX_DESIGN_BYTES / 3) + 1))).toBe(true)
  })
})

describe("collectDesigns", () => {
  const messages = [
    { id: "m1", role: "user" },
    { id: "m2", role: "assistant" },
    { id: "m3", role: "assistant" },
  ]
  const parts = {
    m1: [{ id: "p1", type: "text", text: '```html canvas title="User"\n<p>u</p>\n```' }],
    m2: [
      { id: "p2", type: "reasoning", text: '```html canvas title="Thought"\n<p>r</p>\n```' },
      {
        id: "p3",
        type: "text",
        text: '```html canvas title="One"\n<p>1</p>\n```\n```html title="Small"\n<p>s</p>\n```',
      },
    ],
    m3: [
      { id: "p4", type: "text", text: '```html canvas title="Two"\n<p>2</p>\n```\n```html canvas\n<p>1</p>\n```' },
      { id: "p5", type: "text", text: '```html canvas title="Streaming"\n<p>3' },
    ],
  }

  test("lists closed canvas blocks of assistant text parts in message order", () => {
    expect(collectDesigns(messages, parts)).toEqual([
      { id: designID("<p>1</p>"), title: "One", source: "<p>1</p>", canvas: true },
      { id: designID("<p>2</p>"), title: "Two", source: "<p>2</p>", canvas: true },
    ])
  })

  test("keeps pinned inline designs in place", () => {
    const designs = collectDesigns(messages, parts, [designID("<p>s</p>")])
    expect(designs.map((design) => design.title)).toEqual(["One", "Small", "Two"])
  })

  test("uses the given scanner", () => {
    const scanned: string[] = []
    collectDesigns(messages, parts, [], (part) => {
      scanned.push(part.id)
      return designFences(part.text)
    })
    expect(scanned).toEqual(["p3", "p4", "p5"])
  })
})
