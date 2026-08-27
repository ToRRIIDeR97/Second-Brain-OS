export type NoteEditorCommand =
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "strike"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "inline-code"
  | "code-block"
  | "link"
  | "horizontal-rule"
  | "table"
  | "inline-math"
  | "block-math"
  | "image"

export type TextSelection = { start: number; end: number }
export type TextEdit = { value: string; selection: TextSelection }

export const noteEditorCommands: ReadonlyArray<{
  id: NoteEditorCommand
  label: string
  shortLabel: string
  keywords: string
}> = [
  { id: "h1", label: "Heading 1", shortLabel: "H1", keywords: "title heading" },
  { id: "h2", label: "Heading 2", shortLabel: "H2", keywords: "subtitle heading" },
  { id: "h3", label: "Heading 3", shortLabel: "H3", keywords: "heading" },
  { id: "bold", label: "Bold", shortLabel: "B", keywords: "strong" },
  { id: "italic", label: "Italic", shortLabel: "I", keywords: "emphasis" },
  { id: "strike", label: "Strikethrough", shortLabel: "S", keywords: "delete" },
  { id: "bullet", label: "Bulleted list", shortLabel: "Bullets", keywords: "unordered list" },
  { id: "ordered", label: "Numbered list", shortLabel: "1.", keywords: "ordered list" },
  { id: "task", label: "Task list", shortLabel: "Task", keywords: "check todo" },
  { id: "quote", label: "Quote", shortLabel: "Quote", keywords: "blockquote" },
  { id: "inline-code", label: "Inline code", shortLabel: "Code", keywords: "monospace" },
  { id: "code-block", label: "Code block", shortLabel: "Block", keywords: "fence snippet" },
  { id: "link", label: "Link", shortLabel: "Link", keywords: "url href" },
  { id: "horizontal-rule", label: "Horizontal rule", shortLabel: "Rule", keywords: "divider separator" },
  { id: "table", label: "3 by 3 table", shortLabel: "Table", keywords: "grid columns rows" },
  { id: "inline-math", label: "Inline math", shortLabel: "Math", keywords: "latex katex equation" },
  { id: "block-math", label: "Math block", shortLabel: "Math block", keywords: "latex katex equation" },
  { id: "image", label: "Image URL", shortLabel: "Image", keywords: "picture url" },
]

const clampSelection = (value: string, selection: TextSelection): TextSelection => {
  const start = Math.max(0, Math.min(value.length, selection.start))
  const end = Math.max(start, Math.min(value.length, selection.end))
  return { start, end }
}

const replace = (
  value: string,
  selection: TextSelection,
  text: string,
  selectedStart = 0,
  selectedLength = 0,
): TextEdit => ({
  value: value.slice(0, selection.start) + text + value.slice(selection.end),
  selection: {
    start: selection.start + selectedStart,
    end: selection.start + selectedStart + selectedLength,
  },
})

const wrap = (
  value: string,
  selection: TextSelection,
  prefix: string,
  suffix: string,
  placeholder: string,
): TextEdit => {
  const selected = value.slice(selection.start, selection.end) || placeholder
  return replace(value, selection, prefix + selected + suffix, prefix.length, selected.length)
}

const prefixLines = (
  value: string,
  selection: TextSelection,
  prefix: string | ((index: number) => string),
): TextEdit => {
  const lineStart = selection.start === 0 ? 0 : value.lastIndexOf("\n", selection.start - 1) + 1
  const selectedEnd =
    selection.end > selection.start && value[selection.end - 1] === "\n" ? selection.end - 1 : selection.end
  const nextBreak = value.indexOf("\n", selectedEnd)
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const block = value.slice(lineStart, lineEnd)
  const lines = block.split("\n")
  const markers = lines.map((_line, index) => (typeof prefix === "string" ? prefix : prefix(index)))
  const transformed = lines.map((line, index) => `${markers[index]}${line}`).join("\n")
  const starts = lines.map((_line, index) => lines.slice(0, index).reduce((total, line) => total + line.length + 1, 0))
  const addedAt = (position: number) =>
    starts.reduce(
      (total, offset, index) => total + (lineStart + offset <= position ? (markers[index]?.length ?? 0) : 0),
      0,
    )
  return {
    value: value.slice(0, lineStart) + transformed + value.slice(lineEnd),
    selection: {
      start: selection.start + addedAt(selection.start),
      end: selection.end + addedAt(selection.end),
    },
  }
}

const block = (
  value: string,
  selection: TextSelection,
  content: string,
  selectedOffset: number,
  selectedLength: number,
): TextEdit => {
  const before = selection.start > 0 && value[selection.start - 1] !== "\n" ? "\n" : ""
  const after = selection.end < value.length && value[selection.end] !== "\n" ? "\n" : ""
  return replace(value, selection, before + content + after, before.length + selectedOffset, selectedLength)
}

const horizontalRule = (value: string, selection: TextSelection): TextEdit => {
  const before =
    selection.start === 0
      ? ""
      : value.slice(0, selection.start).endsWith("\n\n")
        ? ""
        : value[selection.start - 1] === "\n"
          ? "\n"
          : "\n\n"
  const after =
    selection.end === value.length
      ? ""
      : value.slice(selection.end).startsWith("\n\n")
        ? ""
        : value[selection.end] === "\n"
          ? "\n"
          : "\n\n"
  return replace(value, selection, `${before}---${after}`, before.length, 3)
}

export function applyNoteEditorCommand(
  command: NoteEditorCommand,
  value: string,
  rawSelection: TextSelection,
): TextEdit {
  const selection = clampSelection(value, rawSelection)
  if (command === "h1") return prefixLines(value, selection, "# ")
  if (command === "h2") return prefixLines(value, selection, "## ")
  if (command === "h3") return prefixLines(value, selection, "### ")
  if (command === "bullet") return prefixLines(value, selection, "- ")
  if (command === "ordered") return prefixLines(value, selection, (index) => `${index + 1}. `)
  if (command === "task") return prefixLines(value, selection, "- [ ] ")
  if (command === "quote") return prefixLines(value, selection, "> ")
  if (command === "bold") return wrap(value, selection, "**", "**", "text")
  if (command === "italic") return wrap(value, selection, "_", "_", "text")
  if (command === "strike") return wrap(value, selection, "~~", "~~", "text")
  if (command === "inline-code") return wrap(value, selection, "`", "`", "code")
  if (command === "inline-math") return wrap(value, selection, "\\(", "\\)", "math")
  if (command === "link") return wrap(value, selection, "[", "](https://)", "text")
  if (command === "image") return wrap(value, selection, "![", "](https://)", "alt text")

  const selected = value.slice(selection.start, selection.end)
  if (command === "code-block") {
    const inner = selected || "code"
    return block(value, selection, `\`\`\`\n${inner}\n\`\`\``, 4, inner.length)
  }
  if (command === "block-math") {
    const inner = selected || "math"
    return block(value, selection, `$$\n${inner}\n$$`, 3, inner.length)
  }
  if (command === "horizontal-rule") return horizontalRule(value, selection)

  const table =
    "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |"
  return block(value, selection, table, 2, 8)
}

export type SlashCommandRange = { start: number; end: number; query: string }

export function findSlashCommand(value: string, caret: number): SlashCommandRange | undefined {
  const end = Math.max(0, Math.min(value.length, caret))
  const lineStart = end === 0 ? 0 : value.lastIndexOf("\n", end - 1) + 1
  const line = value.slice(lineStart, end)
  const match = line.match(/^\s*\/(.*)$/)
  if (!match) return
  const slash = line.indexOf("/")
  return { start: lineStart + slash, end, query: match[1] ?? "" }
}

export function applySlashCommand(command: NoteEditorCommand, value: string, slash: SlashCommandRange): TextEdit {
  const withoutQuery = value.slice(0, slash.start) + value.slice(slash.end)
  return applyNoteEditorCommand(command, withoutQuery, { start: slash.start, end: slash.start })
}
