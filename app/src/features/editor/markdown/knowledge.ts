export const KNOWLEDGE_DIRECTIVES = new Set([
  "align",
  "callout",
  "columns",
  "data-table",
  "decision",
  "graph",
  "planner",
  "project",
  "styled",
]);

export interface DirectiveAttribute {
  name: string;
  value: string;
}

export interface KnowledgeDirective {
  name: string;
  attributes: DirectiveAttribute[];
  body: string;
  raw: string;
  known: boolean;
}

const opener = /^:::([A-Za-z][\w-]*)(?:\{(.*)\})?\s*$/;

function parseAttributes(source: string): DirectiveAttribute[] | undefined {
  const attributes: DirectiveAttribute[] = [];
  let rest = source.trim();
  while (rest) {
    const match =
      /^([A-Za-z_][\w-]*)\s*=\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\s]+))\s*/.exec(
        rest,
      );
    if (!match) return undefined;
    const quoted = match[2] ?? match[3];
    attributes.push({
      name: match[1] ?? "",
      value:
        quoted === undefined
          ? (match[4] ?? "")
          : quoted.replace(/\\(["'\\])/g, "$1"),
    });
    rest = rest.slice(match[0].length);
  }
  return attributes;
}

export function directiveEnd(
  lines: readonly string[],
  start: number,
): number | undefined {
  if (!opener.test(lines[start] ?? "")) return undefined;
  let depth = 1;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (opener.test(line)) depth += 1;
    else if (/^:::\s*$/.test(line)) depth -= 1;
    if (depth === 0) return index + 1;
  }
  return undefined;
}

export function parseDirective(raw: string): KnowledgeDirective | undefined {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const match = opener.exec(lines[0] ?? "");
  if (!match || directiveEnd(lines, 0) !== lines.length) return undefined;
  const attributes = parseAttributes(match[2] ?? "");
  if (!attributes) return undefined;
  const name = match[1] ?? "";
  return {
    name,
    attributes,
    body: lines.slice(1, -1).join("\n"),
    raw,
    known: KNOWLEDGE_DIRECTIVES.has(name),
  };
}

export function serializeDirective(
  directive: Pick<KnowledgeDirective, "name" | "attributes" | "body">,
): string {
  const attributes = [...directive.attributes]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(
      ({ name, value }) =>
        `${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
    )
    .join(" ");
  return `:::${directive.name}${attributes ? `{${attributes}}` : ""}\n${directive.body}\n:::`;
}

export function directiveFallback(directive: KnowledgeDirective): {
  label: string;
  text: string;
} {
  const title = directive.attributes.find(
    ({ name }) => name === "title",
  )?.value;
  const target = directive.attributes.find(
    ({ name }) => name === "query" || name === "view" || name === "project",
  )?.value;
  return {
    label: title || `${directive.name} embed`,
    text:
      directive.body.trim() || target || "Open source to configure this embed.",
  };
}

export function validateAttachmentPath(path: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  if (
    !decoded ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.startsWith("/") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(decoded)
  )
    return undefined;
  const segments = decoded.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  )
    return undefined;
  return segments.join("/");
}

export function attachmentMarkdown(
  relativePath: string,
  alt: string,
): string | undefined {
  const safePath = validateAttachmentPath(relativePath);
  if (!safePath) return undefined;
  const href = safePath
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[()]/g,
        (character) => `%${character.charCodeAt(0).toString(16)}`,
      ),
    )
    .join("/");
  return `![${alt.replace(/[[\]]/g, "\\$&")}](${href})`;
}

export function isSafeMermaidSource(source: string): boolean {
  return (
    !/<\/?(?:script|iframe|object|embed|style|link|img)\b/i.test(source) &&
    !/^\s*click\s+\S+/im.test(source)
  );
}
