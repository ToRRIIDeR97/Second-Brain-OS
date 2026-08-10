import { describe, expect, it } from "vitest";
import { lspServerForLanguage } from "./lspClient";

describe("lspServerForLanguage", () => {
  it("keeps the executable allowlist tied to supported editor languages", () => {
    expect(lspServerForLanguage("typescript")).toBe("type_script");
    expect(lspServerForLanguage("python")).toBe("python");
    expect(lspServerForLanguage("rust")).toBe("rust");
    expect(lspServerForLanguage("plaintext")).toBeUndefined();
  });
});
