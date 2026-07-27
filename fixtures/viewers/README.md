# Viewer fixtures

These small fixtures exercise routing and safe fallback behavior. The large
fixture is represented by the generated fixture harness in tests; production
reads must stream it rather than loading the full file into the renderer.

- `csv/wide.csv`: bounded tabular preview with an intentionally wide row.
- `json/sample.json` and `yaml/sample.yaml`: tree/source parsing.
- `malicious/active.html` and `malicious/active.svg`: active content that must
  remain source-only.
