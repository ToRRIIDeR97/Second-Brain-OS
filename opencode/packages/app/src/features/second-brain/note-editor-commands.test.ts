import { describe, expect, test } from "bun:test"
import { applyNoteEditorCommand, applySlashCommand, findSlashCommand } from "./note-editor-commands"

describe("note editor commands", () => {
  test("wraps an inline selection without changing surrounding Markdown", () => {
    const result = applyNoteEditorCommand("bold", "before text after", { start: 7, end: 11 })

    expect(result).toEqual({
      value: "before **text** after",
      selection: { start: 9, end: 13 },
    })
  })

  test("prefixes every selected line and leaves adjacent lines alone", () => {
    const value = "keep\none\ntwo\nkeep"
    const result = applyNoteEditorCommand("ordered", value, { start: 5, end: 12 })

    expect(result).toEqual({
      value: "keep\n1. one\n2. two\nkeep",
      selection: { start: 8, end: 18 },
    })
  })

  test("preserves a partial-line selection after adding a line prefix", () => {
    expect(applyNoteEditorCommand("h2", "alpha beta", { start: 6, end: 10 })).toEqual({
      value: "## alpha beta",
      selection: { start: 9, end: 13 },
    })
  })

  test("surrounds a horizontal rule with blank lines so it cannot become a setext heading", () => {
    expect(applyNoteEditorCommand("horizontal-rule", "beforeafter", { start: 6, end: 6 })).toEqual({
      value: "before\n\n---\n\nafter",
      selection: { start: 8, end: 11 },
    })
  })

  test("wraps code and math selections as blocks", () => {
    expect(applyNoteEditorCommand("code-block", "const x = 1", { start: 0, end: 11 })).toEqual({
      value: "```\nconst x = 1\n```",
      selection: { start: 4, end: 15 },
    })
    expect(applyNoteEditorCommand("block-math", "x + y", { start: 0, end: 5 })).toEqual({
      value: "$$\nx + y\n$$",
      selection: { start: 3, end: 8 },
    })
  })

  test("uses the renderer's inline KaTeX delimiters", () => {
    expect(applyNoteEditorCommand("inline-math", "x + y", { start: 0, end: 5 })).toEqual({
      value: "\\(x + y\\)",
      selection: { start: 2, end: 7 },
    })
  })

  test("inserts a three-column, three-body-row table", () => {
    const result = applyNoteEditorCommand("table", "", { start: 0, end: 0 })

    expect(result.value.split("\n")).toEqual([
      "| Column 1 | Column 2 | Column 3 |",
      "| --- | --- | --- |",
      "| Cell | Cell | Cell |",
      "| Cell | Cell | Cell |",
      "| Cell | Cell | Cell |",
    ])
    expect(result.selection).toEqual({ start: 2, end: 10 })
  })
})

describe("slash command detection", () => {
  test("returns the query and replacement range at the start of a line", () => {
    expect(findSlashCommand("intro\n  /code bl", 16)).toEqual({ start: 8, end: 16, query: "code bl" })
    expect(findSlashCommand("/table", 6)).toEqual({ start: 0, end: 6, query: "table" })
  })

  test("ignores slashes after other line content", () => {
    expect(findSlashCommand("text /bold", 10)).toBeUndefined()
    expect(findSlashCommand("/bold\nnext", 10)).toBeUndefined()
  })

  test("removes the slash query before applying its command", () => {
    const value = "before\n/bold"
    const slash = findSlashCommand(value, value.length)!

    expect(applySlashCommand("bold", value, slash)).toEqual({
      value: "before\n**text**",
      selection: { start: 9, end: 13 },
    })
  })
})
