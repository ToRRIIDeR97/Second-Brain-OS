import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { createMarkdownExtensions } from "./extensions";
import { renderSafeMath } from "./math";

describe("Markdown extensions", () => {
  it("uses lowlight code blocks with language attributes and resizable tables", () => {
    const extensions = createMarkdownExtensions();
    const codeBlock = extensions.find(
      (extension) => extension.name === "codeBlock",
    ) as { options: { lowlight: { listLanguages: () => string[] } } };
    const table = extensions.find(
      (extension) => extension.name === "table",
    ) as {
      options: { resizable: boolean };
    };

    expect(codeBlock.options.lowlight.listLanguages()).toContain("typescript");
    expect(table.options.resizable).toBe(true);

    const editor = new Editor({
      extensions,
      content: {
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: "typescript" },
            content: [{ type: "text", text: "const answer = 42" }],
          },
        ],
      },
    });
    const first = editor.getJSON().content[0];
    if (!first) throw new Error("code block content missing");
    expect(first.attrs?.language).toBe("typescript");
    editor.destroy();
  });

  it("renders safe KaTeX and leaves malformed source recoverable", () => {
    expect(() => renderSafeMath("\\notACommand", false)).not.toThrow();
    expect(renderSafeMath("<script>alert(1)</script>", false)).not.toContain(
      "<script>",
    );
    expect(renderSafeMath("x^2", false)).toContain("katex");
  });
});
