import { describe, expect, it } from "vitest";
import { markdownCodec, MARKDOWN_CODEC_VERSION } from "./codec";

describe("MarkdownCodec v1", () => {
  it("preserves untouched CRLF source and front matter", () => {
    const source =
      "---\r\nschema_version: 1\r\n---\r\n\r\n# Hello\r\n\r\nUnknown: :::future\r\n";
    const document = markdownCodec.parse(source);
    expect(document.codecVersion).toBe(MARKDOWN_CODEC_VERSION);
    expect(document.lineEnding).toBe("crlf");
    expect(markdownCodec.serialize(document)).toBe(source);
    expect(document.frontMatter).toContain("schema_version: 1");
  });

  it("keeps protected directives visible in the editable projection", () => {
    const source = "# Note\n\n:::future{answer=42}\nopaque content\n:::\n";
    const document = markdownCodec.parse(source);
    expect(document.nodes.some((node) => node.type === "protectedSource")).toBe(
      true,
    );
    const report = markdownCodec.validateRoundTrip(source);
    expect(report.stable).toBe(true);
    expect(report.protectedBlockCount).toBe(1);
  });

  it("serializes core marks, tasks, tables, images, math, and wiki links deterministically", () => {
    const source = [
      "- [x] **Ship** [[Project#Plan]] ![diagram](assets/diagram.png){width=320}",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| $x$ | `42` |",
    ].join("\n");
    const first = markdownCodec.validateRoundTrip(source);
    expect(first.stable).toBe(true);
    expect(markdownCodec.extractIndexHints(source).wikiLinks).toEqual([
      { target: "Project", heading: "Plan" },
    ]);
  });

  it("does not throw for malformed Markdown", () => {
    expect(() =>
      markdownCodec.parse("```\nunterminated\n:::broken\n"),
    ).not.toThrow();
    expect(markdownCodec.validateRoundTrip("```\nunterminated\n").stable).toBe(
      true,
    );
  });

  it("serializes edited code and math nodes instead of dropping their content", () => {
    const source = markdownCodec.parse("```ts\nold\n```\n\n$$\nold math\n$$");
    const edited = {
      ...source,
      sourceEdited: true,
      nodes: [
        {
          type: "codeBlock" as const,
          attrs: { language: "ts" },
          content: [{ type: "text" as const, text: "new" }],
        },
        {
          type: "mathBlock" as const,
          attrs: { value: "new math" },
          content: [{ type: "text" as const, text: "new math" }],
        },
      ],
    };
    const output = markdownCodec.serialize(edited, { preserveSource: false });
    expect(output).toContain("```ts\nnew\n```");
    expect(output).toContain("$$\nnew math\n$$");
  });
});
