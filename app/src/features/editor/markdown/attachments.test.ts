import { describe, expect, it } from "vitest";
import {
  bytesToBase64,
  createImageAttachmentPlacement,
  imageDataUrl,
  resolveImageAttachmentPath,
  supportedImageMediaType,
} from "./attachments";

describe("workspace image attachments", () => {
  it("places normalized images below the note and returns a note-relative path", () => {
    expect(
      createImageAttachmentPlacement(
        "notes/foo.md",
        "../My holiday photo!!.PNG",
        "image/png",
        "fixed-id",
      ),
    ).toEqual({
      workspaceRelativePath: "notes/assets/My-holiday-photo-fixed-id.png",
      markdownPath: "assets/My-holiday-photo-fixed-id.png",
      mediaType: "image/png",
    });
    expect(
      createImageAttachmentPlacement(
        "notes/foo.md",
        "photo.png",
        "application/octet-stream",
        "fixed-id",
      ),
    ).toBeUndefined();
  });

  it("resolves only safe note-relative sources", () => {
    expect(resolveImageAttachmentPath("notes/foo.md", "assets/photo.png")).toBe(
      "notes/assets/photo.png",
    );
    expect(resolveImageAttachmentPath("foo.md", "assets/photo.png")).toBe(
      "assets/photo.png",
    );
    for (const source of [
      "https://example.test/photo.png",
      "data:image/png;base64,AAAA",
      "/tmp/photo.png",
      "C:\\photo.png",
      "../secret.png",
      "assets/../../secret.png",
      "%2e%2e/secret.png",
    ])
      expect(
        resolveImageAttachmentPath("notes/foo.md", source),
      ).toBeUndefined();
  });

  it("builds data URLs only for bounded, supported image responses", () => {
    expect(supportedImageMediaType("photo.png", "")).toBe("image/png");
    expect(bytesToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe(
      "aGVsbG8=",
    );
    expect(imageDataUrl("aGVsbG8=", "image/png", 5)).toBe(
      "data:image/png;base64,aGVsbG8=",
    );
    expect(imageDataUrl("aGVsbG8=", "text/html", 5)).toBeUndefined();
    expect(imageDataUrl("aGVsbG8=", "image/png", 4)).toBeUndefined();
  });
});
