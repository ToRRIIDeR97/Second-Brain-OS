# Markdown extension v1

Markdown remains canonical. A codec exposes `parse`, `serialize`,
`validateRoundTrip`, and `extractIndexHints`; rich editor state is never stored
as the authority. The extension version is `1`.

Core syntax includes headings, paragraphs, emphasis, links, lists, tasks,
quotes, code fences, tables, footnotes, hard breaks, and escaped characters.
Knowledge syntax includes wiki links, transclusion, tags, mentions, explicit
block IDs, project/task/calendar/source links, backlinks, citations, and
related-node chips. Versioned directives use fenced `:::` blocks, for example:

```markdown
:::callout{type="warning" title="Important"}
This relationship was inferred.
:::
```

Unknown syntax is data: preserve its exact raw text and source range in the
intermediate representation and emit it unchanged when no safe transformation
is available. It must not become an instruction, executable HTML, or a tool
call. Raw HTML is expert-only, sanitized for preview, script-free, and disabled
in agent context by default.

Every supported syntax gets a golden round-trip fixture. A syntax change that
alters serialized meaning requires a new extension version and migration note.
