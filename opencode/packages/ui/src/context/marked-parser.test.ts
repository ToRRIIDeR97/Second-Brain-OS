import { expect, test } from "bun:test"
import { createMarkdownParser } from "./marked-parser"

test("link labels render inline Markdown and attributes are escaped", async () => {
  const parser = createMarkdownParser((code) => `<pre>${code}</pre>`)
  const html = await parser.parse('[**bold** `code`](https://x.test/a?b=1&c=2 "say \\"hi\\"")')
  expect(html).toContain("><strong>bold</strong> <code>code</code></a>")
  expect(html).toContain('title="say &quot;hi&quot;"')
  expect(html).toContain('href="https://x.test/a?b=1&amp;c=2"')
})
