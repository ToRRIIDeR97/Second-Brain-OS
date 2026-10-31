import { expect, test } from "bun:test"
import { redactSecrets } from "../../src/config/redact"

test("config sent to the renderer drops credential fields wherever they appear", () => {
  const config = {
    shell: "zsh",
    provider: { custom: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://x.test", apiKey: "sk-1" } } },
    mcp: {
      remote: { type: "remote", url: "https://mcp.test", headers: { Authorization: "Bearer t" } },
      local: { type: "local", command: ["server"], environment: { TOKEN: "t" } },
    },
    list: [{ token: "t", name: "kept" }],
  }
  expect(redactSecrets(config) as unknown).toEqual({
    shell: "zsh",
    provider: { custom: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://x.test" } } },
    mcp: {
      remote: { type: "remote", url: "https://mcp.test" },
      local: { type: "local", command: ["server"] },
    },
    list: [{ name: "kept" }],
  })
})
