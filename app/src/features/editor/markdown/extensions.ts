import { Mark, mergeAttributes, Node } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import {
  directiveFallback,
  type DirectiveAttribute,
  type KnowledgeDirective,
} from "./knowledge";

export const UnderlineMark = Mark.create({
  name: "underline",
  parseHTML: () => [{ tag: "u" }],
  renderHTML: ({ HTMLAttributes }) => ["u", mergeAttributes(HTMLAttributes), 0],
});

export const WikiLinkMark = Mark.create({
  name: "wikiLink",
  addAttributes: () => ({
    target: { default: "" },
    heading: { default: null },
  }),
  parseHTML: () => [{ tag: "a[data-wiki-link]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "a",
    mergeAttributes(HTMLAttributes, { "data-wiki-link": "true" }),
    0,
  ],
});

export const InlineMathNode = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ value: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-inline-math]" }],
  renderHTML: ({ node }) => {
    const rawValue = (node.attrs as Record<string, unknown>).value;
    const value = typeof rawValue === "string" ? rawValue : "";
    return [
      "span",
      { "data-inline-math": "true", "data-value": value },
      `$${value}$`,
    ];
  },
});

export const MathBlockNode = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes: () => ({ value: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-math-block]" }],
  renderHTML: ({ node }) => {
    const rawValue = (node.attrs as Record<string, unknown>).value;
    const value = typeof rawValue === "string" ? rawValue : "";
    return [
      "div",
      { "data-math-block": "true", "data-value": value },
      `$$\n${value}\n$$`,
    ];
  },
});

export const ProtectedSourceNode = Node.create({
  name: "protectedSource",
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,
  addAttributes: () => ({ raw: { default: "" } }),
  parseHTML: () => [{ tag: "pre[data-protected-source]" }],
  renderHTML: ({ node }) => [
    "pre",
    {
      "data-protected-source": "true",
      "aria-label": "Unsupported Markdown source",
    },
    ["code", {}, node.attrs.raw],
  ],
});

export const DirectiveNode = Node.create({
  name: "directive",
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,
  addAttributes: () => ({
    name: { default: "" },
    attributes: { default: "[]" },
    body: { default: "" },
    known: { default: false },
    raw: { default: "" },
  }),
  parseHTML: () => [{ tag: "aside[data-markdown-directive]" }],
  renderHTML: ({ node }) => {
    const attrs = node.attrs as Record<string, unknown>;
    let attributes: DirectiveAttribute[] = [];
    try {
      const parsed: unknown = JSON.parse(
        typeof attrs.attributes === "string" ? attrs.attributes : "[]",
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
      // The source view remains the escape hatch for malformed attributes.
    }
    const directive: KnowledgeDirective = {
      name: typeof attrs.name === "string" ? attrs.name : "",
      attributes,
      body: typeof attrs.body === "string" ? attrs.body : "",
      raw: typeof attrs.raw === "string" ? attrs.raw : "",
      known: attrs.known === true,
    };
    const fallback = directiveFallback(directive);
    return [
      "aside",
      {
        "data-markdown-directive": directive.name,
        "aria-label": fallback.label,
      },
      ["strong", {}, fallback.label],
      ["p", {}, fallback.text],
    ];
  },
});

export const MarkdownExtensions = [
  StarterKit.configure({ link: false }),
  Link.configure({ openOnClick: false, autolink: false }),
  Image.configure({ inline: true, allowBase64: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  TaskItem.configure({ nested: true }),
  WikiLinkMark,
  InlineMathNode,
  MathBlockNode,
  DirectiveNode,
  ProtectedSourceNode,
];
