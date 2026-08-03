import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, vi } from "vitest";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (value: string | undefined) => void;
  }) => (
    <textarea
      aria-label="Markdown source"
      value={value ?? ""}
      onChange={(event) => {
        onChange?.(event.currentTarget.value);
      }}
    />
  ),
}));

import { MarkdownEditor } from "./MarkdownEditor";

test("switches between rich and source without losing source edits", async () => {
  const onChange = vi.fn();
  render(<MarkdownEditor value={"# Original\n"} onChange={onChange} />);

  expect(screen.getByRole("button", { name: "Rich" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown source" }), {
    target: { value: "## Updated\n" },
  });
  expect(onChange).toHaveBeenLastCalledWith("## Updated\n");

  fireEvent.click(screen.getByRole("button", { name: "Rich" }));
  expect(
    await screen.findByRole("heading", { name: "Updated", level: 2 }),
  ).toBeInTheDocument();
});

test("applies block formatting and emits Markdown", async () => {
  const onChange = vi.fn();
  render(<MarkdownEditor value={"Paragraph\n"} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "Heading 2" }));
  await waitFor(() => {
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringMatching(/^## Paragraph\n+$/),
    );
  });
});

test("validates links and inserts a link when there is no selection", async () => {
  const onChange = vi.fn();
  render(<MarkdownEditor value={"Paragraph\n"} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "Link" }));
  fireEvent.change(screen.getByLabelText("Text"), {
    target: { value: "OpenAI" },
  });
  fireEvent.change(screen.getByLabelText("URL"), {
    target: { value: "https://openai.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Insert" }));

  await waitFor(() => {
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining("[OpenAI](https://openai.com)"),
    );
  });
});

test("renders a resizable split and switches its orientation", () => {
  render(<MarkdownEditor value={"# Split\n"} mode="split" />);

  expect(screen.getByRole("button", { name: "Split" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByLabelText("Resize Markdown split")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Horizontal split (stacked)" }),
  );
  expect(
    screen.getByRole("button", { name: "Horizontal split (stacked)" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("changes the active code block language and emits a fenced Markdown block", async () => {
  const onChange = vi.fn();
  render(
    <MarkdownEditor
      value={"```\nconst answer = 42;\n```\n"}
      onChange={onChange}
    />,
  );

  const language = screen.getByRole("combobox", {
    name: "Code block language",
  });
  expect(language).toHaveValue("");
  fireEvent.change(language, { target: { value: "javascript" } });

  await waitFor(() => {
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining("```javascript\nconst answer = 42;"),
    );
  });
});

test("inserts a plain-text code block by default", async () => {
  const onChange = vi.fn();
  render(<MarkdownEditor value={"code\n"} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "Code block" }));

  await waitFor(() => {
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining("```\ncode\n```"),
    );
  });
});

test("inserts an inline TeX equation", async () => {
  const onChange = vi.fn();
  render(<MarkdownEditor value={"Equation: "} onChange={onChange} />);

  fireEvent.click(
    screen.getByRole("button", { name: "Insert inline equation" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "TeX source" }), {
    target: { value: "x^2 + y^2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Insert equation" }));

  await waitFor(() => {
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining("$x^2 + y^2$"),
    );
  });
});

test("inserts a display TeX equation", async () => {
  const onChange = vi.fn();
  render(<MarkdownEditor value={"Before\n"} onChange={onChange} />);

  fireEvent.click(
    screen.getByRole("button", { name: "Insert display equation" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "TeX source" }), {
    target: { value: "\\int_0^1 x dx" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Insert equation" }));

  await waitFor(() => {
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining("$$\n\\int_0^1 x dx\n$$"),
    );
  });
});

test("adds a row through the contextual table controls", async () => {
  const onChange = vi.fn();
  render(<MarkdownEditor value={"Table\n"} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "Insert table" }));
  const addRow = screen.getByRole("button", { name: "Add row after" });
  expect(addRow).toBeEnabled();
  fireEvent.click(addRow);

  await waitFor(() => {
    const latest = onChange.mock.lastCall?.[0] as string;
    expect(
      latest.split("\n").filter((line) => line.startsWith("|")),
    ).toHaveLength(5);
  });
});

test("imports a local image through the callback without embedding base64", async () => {
  const onChange = vi.fn();
  const onImportImage = vi
    .fn<(file: File, alt: string) => Promise<string | undefined>>()
    .mockResolvedValue("attachments/photo.png");
  render(
    <MarkdownEditor
      value={"Images\n"}
      onChange={onChange}
      onImportImage={onImportImage}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Insert image" }));
  fireEvent.change(screen.getByLabelText("Alt text"), {
    target: { value: "A photo" },
  });
  const file = new File(["image"], "photo.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Local image file"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Insert" }));

  await waitFor(() => {
    expect(onImportImage).toHaveBeenCalledWith(file, "A photo");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining("![A photo](attachments/photo.png)"),
    );
  });
});
