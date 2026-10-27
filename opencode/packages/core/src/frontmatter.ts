export * as Frontmatter from "./frontmatter"

import matter from "gray-matter"

/** Front matter larger than this is refused before YAML parsing, which blunts alias bombs. */
export const maxBytes = 64 * 1024

export class RejectedError extends Error {
  constructor(readonly reason: "javascript_disabled" | "too_large") {
    super(`front matter rejected: ${reason}`)
  }
}

/**
 * Parse Markdown front matter from untrusted files. gray-matter evaluates a
 * `---js` (or `---javascript`) block with `eval`, so that engine always throws.
 * Passing options also disables gray-matter's unbounded module-level parse cache.
 */
export function parse(source: string) {
  if (frontmatterLength(source) > maxBytes) throw new RejectedError("too_large")
  return matter(source, { engines: { javascript: disabledJavaScript } })
}

/** Characters between the opening `---` and the closing delimiter (or the end of the file). */
function frontmatterLength(source: string) {
  if (!source.startsWith("---")) return 0
  const end = source.indexOf("\n---", 3)
  return end === -1 ? source.length : end
}

function disabledJavaScript(): never {
  throw new RejectedError("javascript_disabled")
}
