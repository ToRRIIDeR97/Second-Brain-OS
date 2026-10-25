// Worker-visible acceptance tests for the built-in Google OAuth client.
// Run from opencode/packages/desktop: bun test ../../../implementations/google-builtin-client/acceptance
import { describe, expect, test } from "bun:test"
import {
  builtInGoogleClient,
  resolveGoogleClient,
} from "../../../opencode/packages/desktop/src/main/google-calendar-domain"

const id = "123-abc.apps.googleusercontent.com"
const secret = "GOCSPX-secret"

describe("built-in Google client", () => {
  test("AC-1 a build with both values has a trimmed built-in client", () => {
    expect(builtInGoogleClient({ clientId: ` ${id} `, clientSecret: ` ${secret}\n` })).toEqual({
      clientId: id,
      clientSecret: secret,
    })
  })

  test("AC-1 a build missing either value has no built-in client", () => {
    expect(builtInGoogleClient({})).toBeUndefined()
    expect(builtInGoogleClient({ clientId: id })).toBeUndefined()
    expect(builtInGoogleClient({ clientSecret: secret })).toBeUndefined()
  })

  test("AC-2 signing in without typed credentials uses the built-in client", () => {
    const builtIn = { clientId: id, clientSecret: secret }
    expect(resolveGoogleClient({}, builtIn)).toEqual(builtIn)
    expect(resolveGoogleClient({ clientId: "", clientSecret: "" }, builtIn)).toEqual(builtIn)
  })

  test("AC-3 typed credentials win over the built-in client", () => {
    const own = { clientId: "999-own.apps.googleusercontent.com", clientSecret: "own-secret" }
    expect(resolveGoogleClient(own, { clientId: id, clientSecret: secret })).toEqual(own)
  })

  test("AC-3 invalid typed credentials fail instead of falling back", () => {
    const builtIn = { clientId: id, clientSecret: secret }
    expect(() => resolveGoogleClient({ clientId: "not-a-client", clientSecret: "x" }, builtIn)).toThrow(
      "google_client_id_invalid",
    )
  })

  test("AC-4 no typed credentials and no built-in client fails with google_client_missing", () => {
    expect(() => resolveGoogleClient({}, undefined)).toThrow("google_client_missing")
  })
})
