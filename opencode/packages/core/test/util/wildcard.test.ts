import { describe, expect, test } from "bun:test"
import { Wildcard } from "../../src/util/wildcard"

describe("Wildcard", () => {
  test("keeps the glob meaning of * and ?", () => {
    expect(Wildcard.match("git status", "git *")).toBe(true)
    expect(Wildcard.match("git", "git *")).toBe(true)
    expect(Wildcard.match("cat a.txt", "cat ?.txt")).toBe(true)
  })

  test("a literal pattern matches only the saved value", () => {
    const saved = Wildcard.literal("rm *")
    expect(Wildcard.match("rm *", saved)).toBe(true)
    expect(Wildcard.match("rm -rf /", saved)).toBe(false)
    expect(Wildcard.match("rm", saved)).toBe(false)

    const query = Wildcard.literal("ls ?.log")
    expect(Wildcard.match("ls ?.log", query)).toBe(true)
    expect(Wildcard.match("ls a.log", query)).toBe(false)
  })

  test("a value that already contains [*] stays literal", () => {
    expect(Wildcard.match("echo [*]", Wildcard.literal("echo [*]"))).toBe(true)
    expect(Wildcard.match("echo [x]", Wildcard.literal("echo [*]"))).toBe(false)
  })
})
