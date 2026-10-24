import { expect, test } from "bun:test"
import { noteKeys, previewNoteLinks, wikiTargetKey } from "./note-links"

test("wiki references survive title renames using the stable filename", () => {
  const notes = [{ path: "notes/qa-beta.md", title: "QA Beta Updated" }]
  expect(noteKeys(notes[0]!)).toContain("qa-beta")
  expect(previewNoteLinks("[[QA Beta]] and [[notes/qa-beta.md|Beta]]", notes)).toBe(
    "[QA Beta](/notes?note=notes%2Fqa-beta.md) and [Beta](/notes?note=notes%2Fqa-beta.md)",
  )
})
test("wiki rendering leaves unknown references and Markdown code unchanged", () => {
  const source = "`[[Beta]]`\n```md\n[[Beta]]\n```\n[[Missing]]\n[[Beta]]"
  expect(previewNoteLinks(source, [{ title: "Beta", path: "notes/beta.md" }])).toBe(
    source.replace(/\[\[Beta\]\]$/, "[Beta](/notes?note=notes%2Fbeta.md)"),
  )
})
test("wiki references with a heading or block suffix resolve to the note", () => {
  const notes = [{ path: "notes/beta.md", title: "Beta" }]
  expect(previewNoteLinks("[[Beta#Plan]] [[beta#^abc123|Block]] [[notes/beta.md#Plan]]", notes)).toBe(
    "[Beta#Plan](/notes?note=notes%2Fbeta.md) [Block](/notes?note=notes%2Fbeta.md) [notes/beta.md#Plan](/notes?note=notes%2Fbeta.md)",
  )
  expect(wikiTargetKey("Beta Plan#Goals")).toBe("beta-plan")
  expect(previewNoteLinks("[[#Local heading]]", notes)).toBe("[[#Local heading]]")
})
