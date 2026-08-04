import { Mark, mergeAttributes, Node } from "@tiptap/react";
import Image, { type ImageOptions } from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
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
import { ReactNodeViewRenderer } from "@tiptap/react";
import "katex/dist/katex.min.css";
import { createElement } from "react";
import { common, createLowlight } from "lowlight";
import {
  directiveFallback,
  type DirectiveAttribute,
  type KnowledgeDirective,
} from "./knowledge";
import { LocalImageNodeView, type LocalImageResolver } from "./ImageNodeView";
import { MathNodeView } from "./MathNodeView";

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
  parseHTML: () => [
    {
      tag: "span[data-inline-math]",
      getAttrs: (element) => ({
        value: element.getAttribute("data-value") ?? "",
      }),
    },
  ],
  renderHTML: ({ node }) => {
    const rawValue = (node.attrs as Record<string, unknown>).value;
    const value = typeof rawValue === "string" ? rawValue : "";
    return [
      "span",
      { "data-inline-math": "true", "data-value": value },
      `$${value}$`,
    ];
  },
  addNodeView: () => ReactNodeViewRenderer(MathNodeView),
});

export const MathBlockNode = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes: () => ({ value: { default: "" } }),
  parseHTML: () => [
    {
      tag: "div[data-math-block]",
      getAttrs: (element) => ({
        value: element.getAttribute("data-value") ?? "",
      }),
    },
  ],
  renderHTML: ({ node }) => {
    const rawValue = (node.attrs as Record<string, unknown>).value;
    const value = typeof rawValue === "string" ? rawValue : "";
    return [
      "div",
      { "data-math-block": "true", "data-value": value },
      `$$\n${value}\n$$`,
    ];
  },
  addNodeView: () =>
    ReactNodeViewRenderer((props) =>
      createElement(MathNodeView, { ...props, displayMode: true }),
    ),
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

const lowlight = createLowlight(common);

export type MarkdownExtensionOptions = {
  resolveLocalImage?: LocalImageResolver | undefined;
};

type ResolvedImageOptions = ImageOptions & MarkdownExtensionOptions;

export function createMarkdownExtensions(
  options: MarkdownExtensionOptions = {},
) {
  const image = Image.extend<ResolvedImageOptions>({
    addOptions() {
      return {
        inline: false,
        allowBase64: false,
        HTMLAttributes: {},
        resize: false,
        ...this.parent?.(),
        resolveLocalImage: options.resolveLocalImage,
      };
    },
    addNodeView() {
      if (!this.options.resolveLocalImage) return this.parent?.() ?? null;
      const resolver = this.options.resolveLocalImage;
      return ReactNodeViewRenderer((props) =>
        createElement(LocalImageNodeView, {
          ...props,
          resolveLocalImage: resolver,
        }),
      );
    },
  }).configure({ inline: true, allowBase64: false });

  return [
    StarterKit.configure({ link: false, codeBlock: false }),
    CodeBlockLowlight.configure({ lowlight }),
    Link.configure({ openOnClick: false, autolink: false }),
    image,
    Table.configure({ resizable: true }),
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
}

export const MarkdownExtensions = createMarkdownExtensions();
