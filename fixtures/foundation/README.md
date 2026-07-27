# Foundation fixtures

These fixtures are deterministic, small enough for unit tests, and safe to copy
into a temporary workspace. The generated large-tree and symlink cases are
created by the fixture script used by later filesystem tests; no absolute paths
or machine-specific links are committed.

| Fixture | Purpose | Expected scale |
|---|---|---|
| `workspace-small/` | Ordinary Markdown and source files | 3 files |
| `workspace-unicode/` | Unicode names and content | 2 files |
| `workspace-crlf/` | CRLF preservation checks | 1 file |
| `workspace-rich-markdown/` | Headings, table, task, link, and code block | 1 file |
| `workspace-rapid-saves/` | Repeated revisions for debounce tests | 1 file + script-generated revisions |
| `workspace-malicious/` | Secret-like text, traversal-looking names, and inert HTML | 3 files |
| `provider-recordings/` | Redacted provider response samples | 2 JSON records |

The fixture catalogue intentionally does not commit a large generated tree,
Git metadata, or symlinks: those cases are platform-sensitive and should be
created in a temporary root by the owning test.
