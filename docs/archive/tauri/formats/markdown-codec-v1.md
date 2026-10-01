# Markdown codec v1

`MarkdownCodec` is the single boundary between portable Markdown source and
the rich editor projection. Its version is `1`, matching the compatibility
matrix. Rich, source, and split modes share one canonical Markdown string and
the filesystem save coordinator owns persistence.

```ts
interface MarkdownCodec {
  parse(markdown: string, options?: ParseOptions): EditorDocument;
  serialize(document: EditorDocument, options?: SerializeOptions): string;
  validateRoundTrip(markdown: string): RoundTripReport;
  extractIndexHints(markdown: string): IndexHints;
}
```

Untouched documents serialize to their original bytes. This preserves CRLF,
mixed line endings, front matter, whitespace, and source that the current
rich projection does not understand. Unsupported blocks are represented by a
protected source node and are emitted byte-for-byte. An edited projection is
serialized deterministically for the supported v1 subset: headings, marks,
links, wiki links, lists and tasks, code fences, tables, images, inline math,
block math, footnotes, hard breaks, and escaped text.

The codec does not implement custom directives, transclusion, citations,
recovery journals, or conflict merge. Those are later checkpoints and must
extend the golden fixtures rather than silently changing v1 output.

## Compatibility rules

- Keep `codecVersion: 1` on every parsed document.
- Additive fields are compatible; changing serialization or removing a field
  requires a new version and a migration note.
- Repeat-round-trip of an untouched source must be stable.
- Invalid Markdown returns a protected or best-effort document; it must not
  throw from the editor path.
