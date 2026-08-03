import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import {
  editorDocumentToTiptap,
  markdownCodec,
  tiptapToMarkdown,
} from "./codec";
import { MarkdownExtensions } from "./extensions";

type JsonNode = {
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
};

describe("rich Markdown projection", () => {
  it("loads protected source, tables, and code into Tiptap without dropping nodes", () => {
    const source =
      "# Note\n\n| Name | Value |\n| --- | --- |\n| one | two |\n\n```ts\nconst value = 1\n```\n\n:::future\nopaque\n:::\n";
    const editor = new Editor({
      extensions: MarkdownExtensions,
      content: editorDocumentToTiptap(markdownCodec.parse(source)),
    });
    const types = editor.getJSON().content.map((node) => node.type);
    expect(types).toEqual(["heading", "table", "codeBlock", "protectedSource"]);
    editor.destroy();
  });

  it("serializes inserted rich tables as valid Markdown tables", () => {
    const original = markdownCodec.parse("Paragraph\n");
    const editor = new Editor({
      extensions: MarkdownExtensions,
      content: editorDocumentToTiptap(original),
    });
    editor
      .chain()
      .focus()
      .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
      .run();
    const markdown = tiptapToMarkdown(editor.getJSON(), original);
    expect(markdown).toContain("| --- | --- |");
    expect(markdownCodec.validateRoundTrip(markdown).stable).toBe(true);
    editor.destroy();
  });

  it("does not turn a Markdown table separator into a visible data row", () => {
    const source = "| Name | Value |\n| --- | --- |\n| one | two |\n";
    const original = markdownCodec.parse(source);
    const editor = new Editor({
      extensions: MarkdownExtensions,
      content: editorDocumentToTiptap(original),
    });
    const table = editor.state.doc.child(0);
    expect(table.childCount).toBe(2);
    expect(table.child(0).child(0).type.name).toBe("tableHeader");
    expect(tiptapToMarkdown(editor.getJSON(), original)).toBe(source);
    editor.destroy();
  });

  it("round trips resized column widths through Tiptap JSON", () => {
    const source = [
      "<!-- second-brain-table-widths: 180,240 -->",
      "| Name | Value |",
      "| --- | --- |",
      "| one | two |",
      "",
    ].join("\n");
    const original = markdownCodec.parse(source);
    const editor = new Editor({
      extensions: MarkdownExtensions,
      content: editorDocumentToTiptap(original),
    });
    const json = editor.getJSON() as { content?: JsonNode[] };
    const firstCell = json.content?.[0]?.content?.[0]?.content?.[0];
    expect(firstCell?.attrs?.colwidth).toEqual([180]);
    const markdown = tiptapToMarkdown(json, original);
    const reopened = markdownCodec.parse(markdown);
    const reopenedEditor = new Editor({
      extensions: MarkdownExtensions,
      content: editorDocumentToTiptap(reopened),
    });
    const reopenedJson = reopenedEditor.getJSON() as { content?: JsonNode[] };
    expect(
      reopenedJson.content?.[0]?.content?.[0]?.content?.[1]?.attrs?.colwidth,
    ).toEqual([240]);
    reopenedEditor.destroy();
    editor.destroy();
  });
});
