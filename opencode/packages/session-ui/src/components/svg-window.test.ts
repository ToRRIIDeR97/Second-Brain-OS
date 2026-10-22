import { describe, expect, test } from "bun:test"
import { svgDocument, svgSize } from "./svg-window"

const theme = {
  fg: "rgb(1, 2, 3)",
  muted: "rgb(4, 5, 6)",
  accent: "rgb(7, 8, 9)",
  surface: "rgb(10, 11, 12)",
  border: "rgb(13, 14, 15)",
  font: "Inter, sans-serif",
  scheme: "dark",
}

describe("svgSize", () => {
  test("prefers the viewBox", () => {
    expect(svgSize({ viewBox: "0 0 680 400", width: "100%" })).toEqual({ width: 680, height: 400, viewBox: true })
    expect(svgSize({ viewBox: "0,0,10,5" })).toEqual({ width: 10, height: 5, viewBox: true })
  })

  test("falls back to numeric width and height", () => {
    expect(svgSize({ width: "300", height: "150px" })).toEqual({ width: 300, height: 150, viewBox: false })
  })

  test("returns undefined without a usable size", () => {
    expect(svgSize({ viewBox: "0 0 0 10" })).toBeUndefined()
    expect(svgSize({ width: "100%", height: "2em" })).toBeUndefined()
    expect(svgSize({})).toBeUndefined()
  })
})

describe("svgDocument", () => {
  test("blocks every network load and exposes theme variables", () => {
    const doc = svgDocument("<svg></svg>", theme)
    expect(doc).toContain(`content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"`)
    expect(doc).toContain("--tenon-fg:rgb(1, 2, 3)")
    expect(doc).toContain("color-scheme:dark")
    expect(doc).toContain("<body><svg></svg></body>")
  })

  test("drops characters that could break out of the style block", () => {
    const doc = svgDocument("<svg></svg>", { ...theme, font: "x}</style><script>", scheme: "x;}" })
    expect(doc).not.toContain("</style><script>")
    expect(doc).toContain("color-scheme:normal")
  })
})
