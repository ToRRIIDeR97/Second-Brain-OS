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

function parseTable(lines: string[]): MarkdownNode | undefined {
  if (
    lines.length < 2 ||
    !/^\s*\|/.test(lines[0] ?? "") ||
    !/^\s*\|?\s*:?-{3,}/.test(lines[1] ?? "")
  )
    return undefined;
  const rows = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const cells = line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|");
      return {
        type: "tableRow" as const,
        content: cells.map((cell) => ({
          type: "tableCell" as const,
          content: parseInline(cell.trim()),
        })),
      };
    });
  return { type: "table", content: rows };
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

    const fence = /^(```+|~~~+)(.*)$/.exec(first);
    if (fence) {
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
      const table = parseTable(rawLines);
      if (table) node = table;
      else
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
  if (node.type === "table")
    return (node.content ?? [])
      .map(
        (row) =>
          `| ${(row as MarkdownNode).content?.map((cell) => nodeToMarkdown(cell as MarkdownNode)).join(" | ") ?? ""} |`,
      )
      .join("\n");
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
    if (value.type === "tableCell" || value.type === "tableHeader") {
      return {
        type: value.type,
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
