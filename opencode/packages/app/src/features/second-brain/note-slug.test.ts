import { expect, test } from "bun:test"
import { noteSlug } from "./note-slug"

test("note slugs keep letters from any script, including accents", () => {
  expect(noteSlug("Café Plans")).toBe("café-plans")
  expect(noteSlug("Projekt Übersicht")).toBe("projekt-übersicht")
  expect(noteSlug("日本語のメモ")).toBe("日本語のメモ")
  expect(noteSlug("Заметки о работе")).toBe("заметки-о-работе")
})

test("note slugs collapse separators and trim dashes", () => {
  expect(noteSlug("  Q3 -- roadmap / draft!  ")).toBe("q3-roadmap-draft")
  expect(noteSlug("ﬁle")).toBe("file")
})

test("a title without letters or digits falls back to a time-based name", () => {
  expect(noteSlug("🎉🎉", 1_700_000_000_000)).toBe(`note-${(1_700_000_000_000).toString(36)}`)
  expect(noteSlug("---")).toMatch(/^note-[0-9a-z]+$/)
})
