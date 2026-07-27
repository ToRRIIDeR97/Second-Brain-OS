import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { editorDocumentToTiptap, markdownCodec } from "./codec";
import { MarkdownExtensions } from "./extensions";

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
});
