// Independent verification tests for the built-in Google OAuth client.
// Written by the plan author from the same criteria, with different boundary cases.
// Run from opencode/packages/desktop: bun test ../../../implementations/google-builtin-client/verification
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import {
  builtInGoogleClient,
  resolveGoogleClient,
} from "../../../opencode/packages/desktop/src/main/google-calendar-domain"

const id = "42-zz.apps.googleusercontent.com"
const secret = "GOCSPX-built-in"
const builtIn = { clientId: id, clientSecret: secret }

describe("built-in Google client (verification)", () => {
  test("AC-1 blank or malformed build values disable the built-in client", () => {
    expect(builtInGoogleClient({ clientId: "   ", clientSecret: secret })).toBeUndefined()
    expect(builtInGoogleClient({ clientId: id, clientSecret: "  " })).toBeUndefined()
    expect(builtInGoogleClient({ clientId: "example.com", clientSecret: secret })).toBeUndefined()
    expect(builtInGoogleClient({ clientId: id, clientSecret: "has space" })).toBeUndefined()
  })

  test("AC-2 whitespace-only typed fields count as empty", () => {
    expect(resolveGoogleClient({ clientId: "  ", clientSecret: "\t" }, builtIn)).toEqual(builtIn)
  })

  test("AC-3 one typed field is a manual attempt and is validated, not replaced", () => {
    expect(() => resolveGoogleClient({ clientId: "77-own.apps.googleusercontent.com" }, builtIn)).toThrow(
      "google_client_secret_invalid",
    )
    expect(() => resolveGoogleClient({ clientSecret: "own" }, builtIn)).toThrow("google_client_id_invalid")
  })

  test("AC-3 typed credentials are trimmed and the built-in client is left untouched", () => {
    const result = resolveGoogleClient(
      { clientId: " 77-own.apps.googleusercontent.com ", clientSecret: " own " },
      builtIn,
    )
    expect(result).toEqual({ clientId: "77-own.apps.googleusercontent.com", clientSecret: "own" })
    expect(builtIn).toEqual({ clientId: id, clientSecret: secret })
  })

  test("AC-4 whitespace-only typed fields without a built-in client fail with google_client_missing", () => {
    expect(() => resolveGoogleClient({ clientId: " ", clientSecret: " " }, undefined)).toThrow("google_client_missing")
  })

  test("AC-7 the local env file holding the client is ignored by git", () => {
    const root = path.resolve(import.meta.dir, "../../..")
    const result = spawnSync("git", ["check-ignore", "-q", "opencode/packages/desktop/.env.local"], { cwd: root })
    expect(result.status).toBe(0)
  })
})
