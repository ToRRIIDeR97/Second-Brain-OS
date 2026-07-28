import { describe, expect, it } from "vitest";
import {
  attachmentMarkdown,
  directiveFallback,
  isSafeMermaidSource,
  parseDirective,
  serializeDirective,
  validateAttachmentPath,
} from "./knowledge";
import {
  editorDocumentToTiptap,
  markDocumentEdited,
  markdownCodec,
} from "./codec";

describe("Markdown knowledge syntax", () => {
  it("parses nested directives and serializes attributes deterministically", () => {
    const source = [
      ':::callout{title="日本語 \\"title\\"" type=warning future="kept"}',
      "Before",
      ":::columns{count=2}",
      "Nested",
      ":::",
      "After",
      ":::",
    ].join("\n");
    const directive = parseDirective(source);
    expect(directive).toBeDefined();
    if (!directive) return;
    expect(directive.attributes).toContainEqual({
      name: "future",
      value: "kept",
    });
    expect(serializeDirective(directive)).toBe(
      [
        ':::callout{future="kept" title="日本語 \\"title\\"" type="warning"}',
        "Before",
        ":::columns{count=2}",
        "Nested",
        ":::",
        "After",
        ":::",
      ].join("\n"),
    );
  });

  it("keeps known embeds safe and unknown directives protected", () => {
    const source = [
      ':::graph{query="project:alpha" title="Project graph"}',
      "Graph unavailable.",
      ":::",
      "",
      ":::future{answer=42}",
      "Opaque",
      ":::",
    ].join("\n");
    const document = markdownCodec.parse(source);
    expect(document.nodes.map(({ type }) => type)).toEqual([
      "directive",
      "protectedSource",
    ]);
    const rich = editorDocumentToTiptap(document) as {
      content: Array<{ type: string }>;
    };
    expect(rich.content.map(({ type }) => type)).toEqual([
      "directive",
      "protectedSource",
    ]);
    expect(markdownCodec.serialize(document)).toBe(source);
    expect(
      markdownCodec.serialize(markDocumentEdited(document), {
        preserveSource: false,
      }),
    ).toContain(
      ':::graph{query="project:alpha" title="Project graph"}\nGraph unavailable.\n:::',
    );
    const graphSource = source.split("\n\n")[0];
    const graph =
      graphSource === undefined ? undefined : parseDirective(graphSource);
    expect(graph).toBeDefined();
    if (!graph) return;
    expect(directiveFallback(graph)).toEqual({
      label: "Project graph",
      text: "Graph unavailable.",
    });
  });

  it("rejects escaping attachment paths and active Mermaid content", () => {
    expect(validateAttachmentPath("assets/diagram.png")).toBe(
      "assets/diagram.png",
    );
    for (const path of [
      "../secret",
      "assets/../../secret",
      "/tmp/file",
      "C:\\file",
      "https://example.test/file",
      "%2e%2e/secret",
    ])
      expect(validateAttachmentPath(path)).toBeUndefined();
    expect(attachmentMarkdown("assets/diagram.png", "A [diagram]")).toBe(
      "![A \\[diagram\\]](assets/diagram.png)",
    );
    expect(attachmentMarkdown("assets/my (diagram).png", "Diagram")).toBe(
      "![Diagram](assets/my%20%28diagram%29.png)",
    );
    expect(isSafeMermaidSource("flowchart LR\nA --> B")).toBe(true);
    expect(isSafeMermaidSource("click A https://example.test")).toBe(false);
    expect(isSafeMermaidSource("<script>alert(1)</script>")).toBe(false);
  });
});
