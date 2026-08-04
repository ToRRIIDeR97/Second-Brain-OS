/**
 * Portable Markdown codec v1.
 *
 * The codec deliberately keeps the original source beside the editable
 * projection.  A parse/serialize cycle with no edit therefore returns the
 * exact source (including line endings and whitespace), while edits use a
 * deterministic serializer for the supported subset.
 */

import {
  directiveEnd,
  parseDirective,
  serializeDirective,
  type DirectiveAttribute,
} from "./knowledge";

export const MARKDOWN_CODEC_VERSION = 1 as const;

export type LineEnding = "lf" | "crlf" | "mixed";

export type InlineMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "code" }
  | { type: "link"; attrs: { href: string; title?: string } }
  | { type: "wikiLink"; attrs: { target: string; heading?: string } };

export interface InlineText {
  type: "text";
  text: string;
  marks?: InlineMark[];
}

export interface InlineImage {
  type: "image";
  attrs: {
    src: string;
    alt: string;
    title?: string;
    width?: number;
    align?: string;
  };
}

export interface InlineMath {
  type: "inlineMath";
  attrs: { value: string };
}

export type InlineNode = InlineText | InlineImage | InlineMath;

export interface MarkdownNode {
  type:
    | "paragraph"
    | "heading"
    | "blockquote"
    | "bulletList"
    | "orderedList"
    | "taskList"
    | "listItem"
    | "taskItem"
    | "codeBlock"
    | "table"
    | "tableRow"
    | "tableCell"
    | "tableHeader"
    | "horizontalRule"
    | "hardBreak"
    | "footnote"
    | "mathBlock"
    | "directive"
    | "protectedSource";
  attrs?: Record<string, string | number | boolean | null>;
  content?: Array<MarkdownNode | InlineNode>;
  raw?: string;
  sourceId?: string;
}

export interface SourceSegment {
  id: string;
  kind: "frontmatter" | "supported" | "protected";
  raw: string;
  startLine: number;
  endLine: number;
}

export interface EditorDocument {
  codecVersion: typeof MARKDOWN_CODEC_VERSION;
  lineEnding: LineEnding;
  hadFinalNewline: boolean;
  frontMatter?: string;
  nodes: MarkdownNode[];
  sourceSegments: SourceSegment[];
  originalSource: string;
  /** True only after a caller intentionally changes the editable projection. */
  sourceEdited: boolean;
}

export interface ParseOptions {
  preserveSource?: boolean;
}

export interface SerializeOptions {
  lineEnding?: "preserve" | "lf" | "crlf";
  preserveSource?: boolean;
}

export interface RoundTripReport {
  codecVersion: typeof MARKDOWN_CODEC_VERSION;
  firstPass: string;
  secondPass: string;
  stable: boolean;
  changed: boolean;
  protectedBlockCount: number;
}

export interface IndexHints {
  headings: Array<{ level: number; text: string }>;
  wikiLinks: Array<{ target: string; heading?: string }>;
  tags: string[];
  mentions: string[];
}

export interface MarkdownCodec {
  readonly version: typeof MARKDOWN_CODEC_VERSION;
  parse(markdown: string, options?: ParseOptions): EditorDocument;
  serialize(document: EditorDocument, options?: SerializeOptions): string;
  validateRoundTrip(markdown: string): RoundTripReport;
  extractIndexHints(markdown: string): IndexHints;
}

type BlockParse = {
  node: MarkdownNode;
  raw: string;
  kind: SourceSegment["kind"];
};

/**
 * Inert editor metadata: keep column widths in an HTML comment immediately
 * before the pipe table they belong to.  Markdown renderers ignore this line.
 */
const TABLE_WIDTHS_COMMENT =
  /^\s*<!--\s*second-brain-table-widths:\s*([\s\S]*?)\s*-->\s*$/;
const TABLE_WIDTHS_ATTR = "columnWidths";

function parseColumnWidths(
  value: unknown,
  expectedColumns?: number,
): number[] | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part)))
    return undefined;
  const widths = parts.map((part) => Number(part));
  if (
    widths.some(
      (width) =>
        !Number.isFinite(width) || !Number.isInteger(width) || width <= 0,
    )
  )
    return undefined;
  if (expectedColumns !== undefined && widths.length !== expectedColumns)
    return undefined;
  return widths;
}

function parseTableWidthsComment(line: string): string | undefined {
  return TABLE_WIDTHS_COMMENT.exec(line)?.[1];
}

function splitPipeRow(line: string): string[] | undefined {
  if (!/^\s*\|/.test(line)) return undefined;
  let value = line.trim().replace(/^\|/, "");
  if (value.endsWith("|")) value = value.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of value) {
    if (character === "|" && !escaped) {
      cells.push(cell);
      cell = "";
      continue;
    }
    if (character === "\\" && !escaped) escaped = true;
    else escaped = false;
    cell += character;
  }
  cells.push(cell);
  return cells.map((part) => part.trim().replace(/\\\|/g, "|"));
}

function isTableSeparator(line: string): boolean {
  const cells = splitPipeRow(line);
  return (
    cells !== undefined &&
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function tableColumnCount(node: MarkdownNode): number {
  return Math.max(
    0,
    ...(node.content ?? []).map((row) =>
      row.type === "tableRow" ? (row.content ?? []).length : 0,
    ),
  );
}

function detectLineEnding(markdown: string): LineEnding {
  const endings = [...markdown.matchAll(/\r\n|\r|\n/g)].map(
    ([ending]) => ending,
  );
  if (endings.length === 0 || endings.every((ending) => ending === "\n"))
    return "lf";
  if (endings.every((ending) => ending === "\r\n")) return "crlf";
  return "mixed";
}

function normaliseLines(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function restoreLineEndings(
  markdown: string,
  lineEnding: LineEnding,
  option: SerializeOptions["lineEnding"],
): string {
  const requested =
    option === "preserve" || option === undefined ? lineEnding : option;
  if (requested === "crlf") return markdown.replace(/\n/g, "\r\n");
  return markdown;
}

function inlineText(text: string): InlineText {
  return { type: "text", text };
}

function parseInline(value: string): Array<InlineNode> {
  const nodes: InlineNode[] = [];
  let rest = value;
  const token =
    /(!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']+)["'])?\)(?:\{([^}]*)\})?|\[([^\]]+)\]\(([^\s)]+)(?:\s+["']([^"']+)["'])?\)|\[\[([^\]]+)\]\]|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_|\$([^$]+)\$)/;
  while (rest.length > 0) {
    const match = token.exec(rest);
    if (!match) {
      nodes.push(inlineText(rest));
      break;
    }
    if (match.index > 0) nodes.push(inlineText(rest.slice(0, match.index)));
    const full = match[0];
    if (match[1]?.startsWith("![")) {
      const attrs: InlineImage["attrs"] = {
        src: match[3] ?? "",
        alt: match[2] ?? "",
      };
      if (match[4] !== undefined) attrs.title = match[4];
      const width = /width\s*=\s*(\d+)/.exec(match[5] ?? "")?.[1];
      if (width !== undefined) attrs.width = Number(width);
      const align = /align\s*=\s*([\w-]+)/.exec(match[5] ?? "")?.[1];
      if (align !== undefined) attrs.align = align;
      nodes.push({ type: "image", attrs });
    } else if (match[6] !== undefined) {
      nodes.push({
        type: "text",
        text: match[6],
        marks: [
          {
            type: "link",
            attrs: {
              href: match[7] ?? "",
              ...(match[8] ? { title: match[8] } : {}),
            },
          },
        ],
      });
    } else if (match[9] !== undefined) {
      const [target, heading] = match[9].split("#", 2);
      nodes.push({
        type: "text",
        text: match[9],
        marks: [
          {
            type: "wikiLink",
            attrs: { target: target ?? "", ...(heading ? { heading } : {}) },
          },
        ],
      });
    } else if (match[10] !== undefined) {
      nodes.push({ type: "text", text: match[10], marks: [{ type: "code" }] });
    } else if (match[11] !== undefined || match[12] !== undefined) {
      nodes.push({
        type: "text",
        text: match[11] ?? match[12] ?? "",
        marks: [{ type: "bold" }],
      });
    } else if (match[13] !== undefined) {
      nodes.push({
        type: "text",
        text: match[13],
        marks: [{ type: "strike" }],
      });
    } else if (match[14] !== undefined || match[15] !== undefined) {
      nodes.push({
        type: "text",
        text: match[14] ?? match[15] ?? "",
        marks: [{ type: "italic" }],
      });
    } else if (match[16] !== undefined) {
      nodes.push({ type: "inlineMath", attrs: { value: match[16] } });
    } else {
      nodes.push(inlineText(full));
    }
    rest = rest.slice(match.index + full.length);
  }
  return nodes;
}

function parseTable(
  lines: string[],
  encodedWidths?: unknown,
): MarkdownNode | undefined {
  if (
    lines.length < 2 ||
    !splitPipeRow(lines[0] ?? "") ||
    !isTableSeparator(lines[1] ?? "")
  )
    return undefined;
  const rows = [lines[0] ?? "", ...lines.slice(2)]
    .filter((line) => line.trim().length > 0)
    .map((line, rowIndex) => {
      const cells = splitPipeRow(line) ?? [line.trim()];
      return {
        type: "tableRow" as const,
        content: cells.map((cell) => ({
          type:
            rowIndex === 0 ? ("tableHeader" as const) : ("tableCell" as const),
          content: parseInline(cell),
        })),
      };
    });
  const table: MarkdownNode = { type: "table", content: rows };
  const widths = parseColumnWidths(encodedWidths, tableColumnCount(table));
  if (widths) table.attrs = { [TABLE_WIDTHS_ATTR]: widths.join(",") };
  return table;
}

function parsePipeTableAt(
  lines: string[],
  start: number,
): { node: MarkdownNode; end: number } | undefined {
  if (
    !splitPipeRow(lines[start] ?? "") ||
    !isTableSeparator(lines[start + 1] ?? "")
  )
    return undefined;
  let end = start + 2;
  while (
    end < lines.length &&
    (lines[end] ?? "").trim().length > 0 &&
    splitPipeRow(lines[end] ?? "") !== undefined
  )
    end += 1;
  const node = parseTable(lines.slice(start, end));
  return node === undefined ? undefined : { node, end };
}

function parseBlocks(markdown: string): {
  frontMatter?: string;
  blocks: BlockParse[];
  segments: SourceSegment[];
} {
  const source = normaliseLines(markdown);
  const lines = source.split("\n");
  const blocks: BlockParse[] = [];
  const segments: SourceSegment[] = [];
  let index = 0;
  let segmentNumber = 0;
  let frontMatter: string | undefined;

  if (lines[0] === "---") {
    const closing = lines
      .slice(1)
      .findIndex((line) => line === "---" || line === "...");
    if (closing >= 0) {
      const end = closing + 1;
      frontMatter = lines.slice(0, end + 1).join("\n");
      segments.push({
        id: `segment-${String(segmentNumber++)}`,
        kind: "frontmatter",
        raw: frontMatter,
        startLine: 1,
        endLine: end + 1,
      });
      index = end + 1;
      if (lines[index] === "") index += 1;
    }
  }

  while (index < lines.length) {
    if ((lines[index] ?? "").trim() === "") {
      index += 1;
      continue;
    }
    const start = index;
    const first = lines[index] ?? "";
    let end = index + 1;
    let node: MarkdownNode;
    let kind: SourceSegment["kind"] = "supported";

    const metadataWidths = parseTableWidthsComment(first);
    const metadataTable =
      metadataWidths === undefined
        ? undefined
        : parsePipeTableAt(lines, index + 1);
    const plainTable =
      metadataWidths === undefined ? parsePipeTableAt(lines, index) : undefined;
    const fence = /^(```+|~~~+)(.*)$/.exec(first);
    if (metadataWidths !== undefined) {
      if (metadataTable === undefined) {
        kind = "protected";
        node = { type: "protectedSource", raw: first };
      } else {
        const widths = parseColumnWidths(
          metadataWidths,
          tableColumnCount(metadataTable.node),
        );
        if (widths === undefined) {
          kind = "protected";
          node = { type: "protectedSource", raw: first };
        } else {
          node = {
            ...metadataTable.node,
            attrs: { [TABLE_WIDTHS_ATTR]: widths.join(",") },
          };
          end = metadataTable.end;
        }
      }
    } else if (plainTable !== undefined) {
      node = plainTable.node;
      end = plainTable.end;
    } else if (fence) {
      const closing = lines
        .slice(index + 1)
        .findIndex((line) => line.startsWith(fence[1] ?? ""));
      end = closing < 0 ? lines.length : index + closing + 2;
      const bodyEnd = closing < 0 ? end : end - 1;
      node = {
        type: "codeBlock",
        attrs: { language: fence[2]?.trim() ?? "" },
        content: [
          {
            type: "text",
            text: lines
              .slice(index + 1, Math.max(index + 1, bodyEnd))
              .join("\n"),
          },
        ],
        raw: lines.slice(start, end).join("\n"),
      };
    } else if (/^:::[A-Za-z][\w-]*/.test(first)) {
      const directiveEnding = directiveEnd(lines, index);
      const rawDirective =
        directiveEnding === undefined
          ? undefined
          : lines.slice(index, directiveEnding).join("\n");
      const directive =
        rawDirective === undefined ? undefined : parseDirective(rawDirective);
      if (!directive || directiveEnding === undefined) {
        kind = "protected";
        end = index + 1;
        while (end < lines.length && lines[end]?.trim() !== "") end += 1;
        node = {
          type: "protectedSource",
          raw: lines.slice(start, end).join("\n"),
        };
      } else {
        end = directiveEnding;
        kind = directive.known ? "supported" : "protected";
        node = directive.known
          ? {
              type: "directive",
              attrs: {
                name: directive.name,
                attributes: JSON.stringify(directive.attributes),
                body: directive.body,
                known: true,
              },
            }
          : { type: "protectedSource", raw: directive.raw };
      }
    } else if (/^<\/?[a-z][^>]*>/i.test(first) || /^\s*~~~/.test(first)) {
      kind = "protected";
      end = index + 1;
      while (end < lines.length && lines[end]?.trim() !== "") end += 1;
      node = {
        type: "protectedSource",
        raw: lines.slice(start, end).join("\n"),
      };
    } else if (/^(#{1,6})\s+/.test(first)) {
      const match = /^(#{1,6})\s+(.*)$/.exec(first);
      node = {
        type: "heading",
        attrs: { level: match?.[1]?.length ?? 1 },
        content: parseInline(match?.[2] ?? ""),
      };
    } else if (/^\s*>/.test(first)) {
      while (end < lines.length && /^\s*>/.test(lines[end] ?? "")) end += 1;
      node = {
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: parseInline(
              lines
                .slice(start, end)
                .map((line) => line.replace(/^\s*>\s?/, ""))
                .join("\n"),
            ),
          },
        ],
      };
    } else if (/^\s*([-+*])\s+(?:\[[ xX]\]\s+)?/.test(first)) {
      const task = /^\s*[-+*]\s+\[([ xX])\]\s+(.*)$/.exec(first);
      while (end < lines.length && /^\s*[-+*]\s+/.test(lines[end] ?? ""))
        end += 1;
      node = {
        type: task ? "taskList" : "bulletList",
        content: lines.slice(start, end).map((line) => {
          const item = /^\s*[-+*]\s+(.*)$/.exec(line)?.[1] ?? line.trim();
          const checked = /^\[([ xX])\]\s+(.*)$/.exec(item);
          return task
            ? {
                type: "taskItem",
                attrs: { checked: checked?.[1]?.toLowerCase() === "x" },
                content: [
                  {
                    type: "paragraph",
                    content: parseInline(checked?.[2] ?? item),
                  },
                ],
              }
            : {
                type: "listItem",
                content: [{ type: "paragraph", content: parseInline(item) }],
              };
        }),
      };
    } else if (/^\s*\d+[.)]\s+/.test(first)) {
      while (end < lines.length && /^\s*\d+[.)]\s+/.test(lines[end] ?? ""))
        end += 1;
      node = {
        type: "orderedList",
        content: lines.slice(start, end).map((line) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: parseInline(line.replace(/^\s*\d+[.)]\s+/, "")),
            },
          ],
        })),
      };
    } else if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(first)) {
      node = { type: "horizontalRule" };
    } else if (/^\s*\[\^[^\]]+\]:/.test(first)) {
      node = { type: "footnote", raw: first };
    } else if (/^\s*\$\$/.test(first)) {
      const closing = lines
        .slice(index + 1)
        .findIndex((line) => /^\s*\$\$\s*$/.test(line));
      end = closing < 0 ? lines.length : index + closing + 2;
      const bodyEnd = closing < 0 ? end : end - 1;
      node = {
        type: "mathBlock",
        attrs: { value: lines.slice(index + 1, bodyEnd).join("\n") },
        content: [
          { type: "text", text: lines.slice(index + 1, bodyEnd).join("\n") },
        ],
        raw: lines.slice(start, end).join("\n"),
      };
    } else {
      while (
        end < lines.length &&
        (lines[end] ?? "").trim() !== "" &&
        !/^(#{1,6})\s+/.test(lines[end] ?? "") &&
        !/^\s*([-+*]|\d+[.)])\s+/.test(lines[end] ?? "")
      )
        end += 1;
      const rawLines = lines.slice(start, end);
      node = { type: "paragraph", content: parseInline(rawLines.join("\n")) };
    }

    const raw = lines.slice(start, end).join("\n");
    blocks.push({ node, raw, kind });
    segments.push({
      id: `segment-${String(segmentNumber++)}`,
      kind,
      raw,
      startLine: start + 1,
      endLine: end,
    });
    index = end;
  }
  return { ...(frontMatter ? { frontMatter } : {}), blocks, segments };
}

function inlineToMarkdown(node: InlineNode): string {
  if (node.type === "image") {
    const attrs = [
      node.attrs.width === undefined ? "" : `width=${String(node.attrs.width)}`,
      node.attrs.align === undefined ? "" : `align=${node.attrs.align}`,
    ]
      .filter(Boolean)
      .join(" ");
    return `![${node.attrs.alt}](${node.attrs.src})${attrs ? `{${attrs}}` : ""}`;
  }
  if (node.type === "inlineMath") return `$${node.attrs.value}$`;
  const marks = node.marks ?? [];
  let text = node.text;
  for (const mark of [...marks].reverse()) {
    if (mark.type === "bold") text = `**${text}**`;
    else if (mark.type === "italic") text = `*${text}*`;
    else if (mark.type === "underline") text = `<u>${text}</u>`;
    else if (mark.type === "strike") text = `~~${text}~~`;
    else if (mark.type === "code") text = `\`${text}\``;
    else if (mark.type === "link")
      text = `[${text}](${mark.attrs.href}${mark.attrs.title ? ` "${mark.attrs.title}"` : ""})`;
    else
      text = `[[${mark.attrs.target}${mark.attrs.heading ? `#${mark.attrs.heading}` : ""}]]`;
  }
  return text;
}

function tableWidthsFromNode(
  node: MarkdownNode,
  expectedColumns: number,
): number[] | undefined {
  const attrs = node.attrs ?? {};
  const encoded =
    attrs[TABLE_WIDTHS_ATTR] ??
    attrs.tableWidths ??
    attrs.widths ??
    attrs.colwidth;
  const widths = parseColumnWidths(encoded, expectedColumns);
  if (widths) return widths;
  const derived: number[] = [];
  for (let column = 0; column < expectedColumns; column += 1) {
    let value: number | undefined;
    for (const row of node.content ?? []) {
      if (row.type !== "tableRow") continue;
      const cell = row.content?.[column];
      if (!cell || (cell.type !== "tableCell" && cell.type !== "tableHeader"))
        continue;
      const cellWidth = parseColumnWidths(
        cell.attrs?.colwidth ?? cell.attrs?.columnWidth,
        1,
      )?.[0];
      if (cellWidth === undefined) continue;
      if (value !== undefined && value !== cellWidth) return undefined;
      value = cellWidth;
    }
    if (value === undefined) return undefined;
    derived.push(value);
  }
  return derived.length === expectedColumns ? derived : undefined;
}

function nodeToMarkdown(node: MarkdownNode): string {
  const content = (node.content ?? [])
    .map((child) =>
      child.type === "text" ||
      child.type === "image" ||
      child.type === "inlineMath"
        ? inlineToMarkdown(child)
        : nodeToMarkdown(child),
    )
    .join("");
  if (node.type === "protectedSource") return node.raw ?? "";
  if (node.type === "directive") {
    if (node.raw !== undefined) return node.raw;
    let attributes: DirectiveAttribute[] = [];
    try {
      const parsed: unknown = JSON.parse(
        String(node.attrs?.attributes ?? "[]"),
      ) as unknown;
      if (Array.isArray(parsed))
        attributes = parsed.filter(
          (attribute): attribute is DirectiveAttribute =>
            typeof attribute === "object" &&
            attribute !== null &&
            typeof (attribute as DirectiveAttribute).name === "string" &&
            typeof (attribute as DirectiveAttribute).value === "string",
        );
    } catch {
      // Invalid editor attributes serialize without attributes instead of throwing.
    }
    return serializeDirective({
      name: String(node.attrs?.name ?? "unknown"),
      attributes,
      body: String(node.attrs?.body ?? ""),
    });
  }
  if (node.type === "codeBlock") {
    if (node.raw !== undefined) return node.raw;
    const language =
      typeof node.attrs?.language === "string" ? node.attrs.language : "";
    return `\`\`\`${language}\n${content}\n\`\`\``;
  }
  if (node.type === "mathBlock") {
    if (node.raw !== undefined) return node.raw;
    const value =
      typeof node.attrs?.value === "string" ? node.attrs.value : content;
    return `$$\n${value}\n$$`;
  }
  if (node.type === "footnote") return node.raw ?? content;
  if (node.type === "heading")
    return `${"#".repeat(Number(node.attrs?.level ?? 1))} ${content}`;
  if (node.type === "blockquote")
    return content
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  if (node.type === "bulletList" || node.type === "taskList")
    return (node.content ?? [])
      .map(
        (item) =>
          `- ${node.type === "taskList" && item.type === "taskItem" ? `[${item.attrs?.checked === true ? "x" : " "}] ` : ""}${nodeToMarkdown(item as MarkdownNode).replace(/^\n+|\n+$/g, "")}`,
      )
      .join("\n");
  if (node.type === "orderedList")
    return (node.content ?? [])
      .map(
        (item, index) =>
          `${String(index + 1)}. ${nodeToMarkdown(item as MarkdownNode).replace(/^\n+|\n+$/g, "")}`,
      )
      .join("\n");
  if (node.type === "listItem" || node.type === "taskItem")
    return (node.content ?? [])
      .map((child) => nodeToMarkdown(child as MarkdownNode))
      .join("\n");
  if (node.type === "table") {
    const rows = (node.content ?? []).map((row) =>
      ((row as MarkdownNode).content ?? []).map((cell) =>
        nodeToMarkdown(cell as MarkdownNode)
          .replace(/\|/g, "\\|")
          .replace(/\n+/g, "<br>"),
      ),
    );
    if (rows.length === 0) return "";
    const width = Math.max(1, ...rows.map((row) => row.length));
    const renderRow = (row: string[]) =>
      `| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`;
    const table = [
      renderRow(rows[0] ?? []),
      renderRow(Array.from({ length: width }, () => "---")),
      ...rows.slice(1).map(renderRow),
    ].join("\n");
    const widths = tableWidthsFromNode(node, width);
    return widths
      ? `<!-- second-brain-table-widths: ${widths.join(",")} -->\n${table}`
      : table;
  }
  if (
    node.type === "tableRow" ||
    node.type === "tableCell" ||
    node.type === "tableHeader"
  )
    return (node.content ?? [])
      .map((child) =>
        child.type === "text" ||
        child.type === "image" ||
        child.type === "inlineMath"
          ? inlineToMarkdown(child)
          : nodeToMarkdown(child),
      )
      .join("");
  if (node.type === "horizontalRule") return "---";
  if (node.type === "hardBreak") return "  \n";
  return node.raw ?? content;
}

function hasFinalNewline(markdown: string): boolean {
  return /(?:\r\n|\n|\r)$/.test(markdown);
}

function serialiseEdited(document: EditorDocument): string {
  const body = document.nodes.map(nodeToMarkdown).join("\n\n");
  const withFrontMatter =
    document.frontMatter === undefined
      ? body
      : `${document.frontMatter}${body.length > 0 ? "\n\n" : ""}${body}`;
  const withFinalNewline =
    document.hadFinalNewline && !withFrontMatter.endsWith("\n")
      ? `${withFrontMatter}\n`
      : withFrontMatter;
  return restoreLineEndings(withFinalNewline, document.lineEnding, "preserve");
}

function protectedCount(document: EditorDocument): number {
  return document.nodes.filter((node) => node.type === "protectedSource")
    .length;
}

function hintsFromDocument(document: EditorDocument): IndexHints {
  const headings: IndexHints["headings"] = [];
  const wikiLinks: IndexHints["wikiLinks"] = [];
  const tags = new Set<string>();
  const mentions = new Set<string>();
  const visit = (node: MarkdownNode | InlineNode): void => {
    if (node.type === "heading")
      headings.push({
        level: Number(node.attrs?.level ?? 1),
        text: inlineToMarkdown(
          (node.content ?? []).filter(
            (child): child is InlineText => child.type === "text",
          )[0] ?? { type: "text", text: "" },
        ),
      });
    if (node.type === "text") {
      for (const mark of node.marks ?? [])
        if (mark.type === "wikiLink") wikiLinks.push(mark.attrs);
      for (const tag of node.text.matchAll(/(^|\s)#([\p{L}\d_-]+)/gu))
        tags.add(tag[2] ?? "");
      for (const mention of node.text.matchAll(/(^|\s)@([\p{L}\d_-]+)/gu))
        mentions.add(mention[2] ?? "");
    }
    for (const child of "content" in node ? (node.content ?? []) : [])
      visit(child);
  };
  for (const node of document.nodes) visit(node);
  return { headings, wikiLinks, tags: [...tags], mentions: [...mentions] };
}

export const markdownCodec: MarkdownCodec = {
  version: MARKDOWN_CODEC_VERSION,
  parse(markdown) {
    const parsed = parseBlocks(markdown);
    return {
      codecVersion: MARKDOWN_CODEC_VERSION,
      lineEnding: detectLineEnding(markdown),
      hadFinalNewline: hasFinalNewline(markdown),
      ...(parsed.frontMatter === undefined
        ? {}
        : { frontMatter: parsed.frontMatter }),
      nodes: parsed.blocks.map(({ node }) => node),
      sourceSegments: parsed.segments,
      originalSource: markdown,
      sourceEdited: false,
    };
  },
  serialize(document, options = {}) {
    const codecVersion = document.codecVersion as number;
    if (codecVersion !== MARKDOWN_CODEC_VERSION)
      throw new Error(
        `Unsupported Markdown codec version: ${String(codecVersion)}`,
      );
    if (options.preserveSource !== false && !document.sourceEdited)
      return document.originalSource;
    return restoreLineEndings(
      serialiseEdited(document),
      document.lineEnding,
      options.lineEnding,
    );
  },
  validateRoundTrip(markdown) {
    const first = markdownCodec.parse(markdown);
    const firstPass = markdownCodec.serialize(first);
    const second = markdownCodec.parse(firstPass);
    const secondPass = markdownCodec.serialize(second);
    return {
      codecVersion: MARKDOWN_CODEC_VERSION,
      firstPass,
      secondPass,
      stable: firstPass === secondPass,
      changed: firstPass !== markdown,
      protectedBlockCount: protectedCount(first),
    };
  },
  extractIndexHints(markdown) {
    return hintsFromDocument(markdownCodec.parse(markdown));
  },
};

export function markDocumentEdited(document: EditorDocument): EditorDocument {
  return { ...document, sourceEdited: true };
}

export function editorDocumentToTiptap(
  document: EditorDocument,
): Record<string, unknown> {
  const node = (value: MarkdownNode | InlineNode): Record<string, unknown> => {
    if (value.type === "text")
      return {
        type: "text",
        text: value.text,
        ...(value.marks
          ? {
              marks: value.marks.map((mark) => ({
                type: mark.type,
                attrs: "attrs" in mark ? mark.attrs : undefined,
              })),
            }
          : {}),
      };
    if (value.type === "image") return { type: "image", attrs: value.attrs };
    if (value.type === "inlineMath")
      return { type: "inlineMath", attrs: value.attrs };
    if (value.type === "protectedSource")
      return { type: "protectedSource", attrs: { raw: value.raw ?? "" } };
    if (value.type === "directive")
      return {
        type: "directive",
        attrs: {
          ...(value.attrs ?? {}),
          raw: value.raw ?? "",
        },
      };
    if (value.type === "table") {
      const columns = tableColumnCount(value);
      const widths = tableWidthsFromNode(value, columns);
      return {
        type: "table",
        ...(value.attrs && Object.keys(value.attrs).length > 0
          ? { attrs: value.attrs }
          : {}),
        content: (value.content ?? []).map((row) => {
          const convertedRow = node(row);
          if (row.type !== "tableRow") return convertedRow;
          return {
            ...convertedRow,
            content: (row.content ?? []).map((cell, column) => {
              const convertedCell = node(cell);
              if (
                widths === undefined ||
                (cell.type !== "tableCell" && cell.type !== "tableHeader") ||
                widths[column] === undefined
              )
                return convertedCell;
              return {
                ...convertedCell,
                attrs: {
                  ...(convertedCell.attrs ?? {}),
                  colwidth: [widths[column]],
                },
              };
            }),
          };
        }),
      };
    }
    if (value.type === "tableCell" || value.type === "tableHeader") {
      const cellAttrs: Record<string, unknown> = { ...(value.attrs ?? {}) };
      if ("colwidth" in cellAttrs) {
        const width = parseColumnWidths(cellAttrs.colwidth, 1);
        if (width) cellAttrs.colwidth = width;
        else delete cellAttrs.colwidth;
      }
      return {
        type: value.type,
        ...(Object.keys(cellAttrs).length > 0 ? { attrs: cellAttrs } : {}),
        content: [
          {
            type: "paragraph",
            ...(value.content ? { content: value.content.map(node) } : {}),
          },
        ],
      };
    }
    const attrs = value.attrs ?? {};
    return {
      type: value.type,
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      ...(value.content ? { content: value.content.map(node) } : {}),
    };
  };
  return { type: "doc", content: document.nodes.map(node) };
}

function parseTiptapColwidth(value: unknown): number | undefined {
  if (!Array.isArray(value) || value.length !== 1) return undefined;
  const width = (value as unknown[])[0];
  return typeof width === "number" &&
    Number.isFinite(width) &&
    Number.isInteger(width) &&
    width > 0
    ? width
    : undefined;
}

function tiptapTableWidths(
  input: { content?: unknown[] },
  columns: number,
): number[] | undefined {
  if (columns < 1) return undefined;
  const widths: Array<number | undefined> = Array.from(
    { length: columns },
    () => undefined,
  );
  for (const rowInput of input.content ?? []) {
    if (!rowInput || typeof rowInput !== "object") continue;
    const row = rowInput as { type?: string; content?: unknown[] };
    if (row.type !== "tableRow") continue;
    let column = 0;
    for (const cellInput of row.content ?? []) {
      if (!cellInput || typeof cellInput !== "object") {
        column += 1;
        continue;
      }
      const cell = cellInput as {
        type?: string;
        attrs?: Record<string, unknown>;
      };
      if (cell.type !== "tableCell" && cell.type !== "tableHeader") {
        column += 1;
        continue;
      }
      if (column >= columns) return undefined;
      const raw = cell.attrs?.colwidth;
      if (raw !== undefined && raw !== null) {
        const width = parseTiptapColwidth(raw);
        if (width === undefined) return undefined;
        if (widths[column] !== undefined && widths[column] !== width)
          return undefined;
        widths[column] = width;
      }
      column += 1;
    }
  }
  return widths.every((width): width is number => width !== undefined)
    ? widths
    : undefined;
}

export function tiptapToMarkdown(
  value: unknown,
  original: EditorDocument,
): string {
  if (!value || typeof value !== "object") return original.originalSource;
  const json = value as { content?: unknown[] };
  const convert = (input: unknown): MarkdownNode | InlineNode | undefined => {
    if (!input || typeof input !== "object") return undefined;
    const candidate = input as {
      type?: string;
      text?: string;
      attrs?: Record<string, unknown>;
      marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
      content?: unknown[];
    };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      const marks: InlineMark[] = [];
      for (const mark of candidate.marks ?? []) {
        if (
          mark.type === "bold" ||
          mark.type === "italic" ||
          mark.type === "underline" ||
          mark.type === "strike" ||
          mark.type === "code"
        )
          marks.push({ type: mark.type });
        else if (mark.type === "link" && typeof mark.attrs?.href === "string")
          marks.push({
            type: "link",
            attrs: {
              href: mark.attrs.href,
              ...(typeof mark.attrs.title === "string"
                ? { title: mark.attrs.title }
                : {}),
            },
          });
        else if (
          mark.type === "wikiLink" &&
          typeof mark.attrs?.target === "string"
        )
          marks.push({
            type: "wikiLink",
            attrs: {
              target: mark.attrs.target,
              ...(typeof mark.attrs.heading === "string"
                ? { heading: mark.attrs.heading }
                : {}),
            },
          });
      }
      return {
        type: "text",
        text: candidate.text,
        ...(marks.length > 0 ? { marks } : {}),
      };
    }
    if (candidate.type === "image" && typeof candidate.attrs?.src === "string")
      return {
        type: "image",
        attrs: {
          src: candidate.attrs.src,
          alt:
            typeof candidate.attrs.alt === "string" ? candidate.attrs.alt : "",
        },
      };
    if (
      candidate.type === "inlineMath" &&
      typeof candidate.attrs?.value === "string"
    )
      return { type: "inlineMath", attrs: { value: candidate.attrs.value } };
    if (candidate.type === "protectedSource")
      return {
        type: "protectedSource",
        raw:
          typeof candidate.attrs?.raw === "string" ? candidate.attrs.raw : "",
      };
    if (
      candidate.type === "directive" &&
      typeof candidate.attrs?.name === "string"
    )
      return {
        type: "directive",
        attrs: {
          name: candidate.attrs.name,
          attributes:
            typeof candidate.attrs.attributes === "string"
              ? candidate.attrs.attributes
              : "[]",
          body:
            typeof candidate.attrs.body === "string"
              ? candidate.attrs.body
              : "",
          known: candidate.attrs.known === true,
        },
        ...(typeof candidate.attrs.raw === "string" && candidate.attrs.raw
          ? { raw: candidate.attrs.raw }
          : {}),
      };
    if (candidate.type === "table") {
      const content = (candidate.content ?? [])
        .map(convert)
        .filter(
          (item): item is MarkdownNode | InlineNode => item !== undefined,
        );
      const columns = Math.max(
        0,
        ...content.map((row) =>
          row.type === "tableRow" ? (row.content ?? []).length : 0,
        ),
      );
      const attrs = Object.fromEntries(
        Object.entries(candidate.attrs ?? {}).filter(
          ([, attr]) =>
            typeof attr === "string" ||
            typeof attr === "number" ||
            typeof attr === "boolean" ||
            attr === null,
        ),
      ) as Record<string, string | number | boolean | null>;
      const widths = tiptapTableWidths(candidate, columns);
      const tableAttrs = widths
        ? { ...attrs, [TABLE_WIDTHS_ATTR]: widths.join(",") }
        : attrs;
      return {
        type: "table",
        ...(Object.keys(tableAttrs).length > 0 ? { attrs: tableAttrs } : {}),
        ...(content.length > 0 ? { content } : {}),
      };
    }
    const supported = new Set<MarkdownNode["type"]>([
      "paragraph",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "taskList",
      "listItem",
      "taskItem",
      "codeBlock",
      "table",
      "tableRow",
      "tableCell",
      "tableHeader",
      "horizontalRule",
      "hardBreak",
      "footnote",
      "mathBlock",
      "directive",
    ]);
    if (
      !candidate.type ||
      !supported.has(candidate.type as MarkdownNode["type"])
    )
      return undefined;
    const attrs = Object.fromEntries(
      Object.entries(candidate.attrs ?? {}).filter(
        ([, attr]) =>
          typeof attr === "string" ||
          typeof attr === "number" ||
          typeof attr === "boolean" ||
          attr === null,
      ),
    ) as Record<string, string | number | boolean | null>;
    if (candidate.type === "tableCell" || candidate.type === "tableHeader") {
      const width = parseTiptapColwidth(candidate.attrs?.colwidth);
      if (width !== undefined) attrs.colwidth = String(width);
      else delete attrs.colwidth;
    }
    return {
      type: candidate.type as MarkdownNode["type"],
      ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
      ...(candidate.content
        ? {
            content: candidate.content
              .map(convert)
              .filter(
                (item): item is MarkdownNode | InlineNode => item !== undefined,
              ),
          }
        : {}),
    };
  };
  const nodes = (json.content ?? [])
    .map(convert)
    .filter(
      (item): item is MarkdownNode =>
        item !== undefined &&
        item.type !== "text" &&
        item.type !== "image" &&
        item.type !== "inlineMath",
    );
  const next: EditorDocument = { ...original, nodes, sourceEdited: true };
  return markdownCodec.serialize(next, { preserveSource: false });
}
