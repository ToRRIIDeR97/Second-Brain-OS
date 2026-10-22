import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const packages = path.resolve(import.meta.dir, "../../../../opencode/packages")
const theme = fs.readFileSync(path.join(packages, "ui/src/styles/tailwind/index.css"), "utf8")

// Tailwind's built-in animation utilities. The theme resets `--*`, so each one needs its token back.
const BUILTIN = ["spin", "ping", "bounce"]

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full)
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe("AC-1 running indicator animation", () => {
  test("AC-1 every built-in animate-* utility used by the app has a theme animation", () => {
    const files = ["app/src", "session-ui/src", "ui/src"].flatMap((dir) => sources(path.join(packages, dir)))
    const missing = files.flatMap((file) => {
      const text = fs.readFileSync(file, "utf8")
      return BUILTIN.filter((name) => new RegExp(`\\banimate-${name}\\b`).test(text))
        .filter((name) => !theme.includes(`--animate-${name}:`))
        .map((name) => `${path.relative(packages, file)} uses animate-${name}`)
    })
    expect(missing).toEqual([])
  })

  test("AC-1 the turn summary indicator stops under reduced motion", () => {
    const file = fs.readFileSync(path.join(packages, "app/src/components/session/turn-steps-summary.tsx"), "utf8")
    const usesLoader = /LoaderV2/.test(file)
    const reducedMotionClass = /motion-reduce:animate-none/.test(file)
    expect(usesLoader || reducedMotionClass).toBe(true)
  })
})
