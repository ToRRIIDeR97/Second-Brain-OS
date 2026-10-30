import { describe, expect, test } from "bun:test"
import { stableDatabaseName } from "./database-name"

describe("stableDatabaseName", () => {
  test("pins installed builds to one database per channel, whatever branch built them", () => {
    expect(stableDatabaseName("dev", true)).toBe("opencode-dev.db")
    expect(stableDatabaseName("beta", true)).toBe("opencode-beta.db")
    expect(stableDatabaseName("prod", true)).toBe("opencode.db")
  })

  test("leaves unpackaged runs on the server's own per-branch database", () => {
    expect(stableDatabaseName("dev", false)).toBeUndefined()
  })
})
