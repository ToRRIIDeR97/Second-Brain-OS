import { describe, expect, it } from "vitest";
import {
  createWorkspaceAssetUrl,
  isValidWorkspaceRelativePath,
  routeFile,
} from "./routing";
import { DEFAULT_LARGE_FILE_SETTINGS, type FileDescriptor } from "./types";

const file = (overrides: Partial<FileDescriptor>): FileDescriptor => ({
  workspaceId: "ws_test",
  relativePath: "notes/readme.md",
  name: "readme.md",
  sizeBytes: 100,
  kind: "markdown",
  sniffed: true,
  isText: true,
  ...overrides,
});

describe("viewer routing policy", () => {
  it("routes oversized Markdown to large-file mode", () => {
    const result = routeFile(
      file({ sizeBytes: DEFAULT_LARGE_FILE_SETTINGS.richEditorMaxBytes + 1 }),
    );
    expect(result.reason).toBe("large-file");
    expect(result.largeFile).toBe(true);
  });

  it("treats HTML and SVG as unsafe active content", () => {
    expect(routeFile(file({ kind: "html", name: "index.html" })).reason).toBe(
      "unsafe-content",
    );
    expect(
      routeFile(
        file({
          kind: "image",
          mediaType: "image/svg+xml",
          name: "diagram.svg",
        }),
      ).reason,
    ).toBe("unsafe-content");
  });

  it("rejects path escapes when constructing asset URLs", () => {
    expect(isValidWorkspaceRelativePath("notes/readme.md")).toBe(true);
    expect(isValidWorkspaceRelativePath("../secret.txt")).toBe(false);
    expect(isValidWorkspaceRelativePath("notes\\secret.txt")).toBe(false);
    expect(createWorkspaceAssetUrl("ws_test", "../secret.txt")).toBeUndefined();
    expect(createWorkspaceAssetUrl("ws_test", "notes/readme.md")).toBe(
      "asset://workspace/ws_test/notes/readme.md",
    );
  });
});
