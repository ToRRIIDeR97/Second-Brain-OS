import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  isSubframeDocumentURL,
  redactURL,
  resolveExternalURL,
  resolveLocalFilePath,
  unparseableURL,
} from "./external-url"

describe("subframe documents", () => {
  test("allows only inline srcdoc and blank documents", () => {
    expect(isSubframeDocumentURL("about:srcdoc")).toBe(true)
    expect(isSubframeDocumentURL("about:srcdoc#section")).toBe(true)
    expect(isSubframeDocumentURL("about:blank")).toBe(true)
    expect(isSubframeDocumentURL("https://example.com/?leak=1")).toBe(false)
    expect(isSubframeDocumentURL("oc://renderer/index.html")).toBe(false)
    expect(isSubframeDocumentURL("data:text/html,<p>x</p>")).toBe(false)
    expect(isSubframeDocumentURL("javascript:alert(1)")).toBe(false)
    expect(isSubframeDocumentURL("about:srcdocx")).toBe(false)
  })
})

describe("external URLs", () => {
  test("opens web URLs externally", () => {
    expect(resolveExternalURL("https://example.com/a?b=c")).toBe("https://example.com/a?b=c")
    expect(resolveExternalURL("http://example.com")).toBe("http://example.com/")
  })

  test("opens mail links externally", () => {
    expect(resolveExternalURL("mailto:hello@opencode.ai")).toBe("mailto:hello@opencode.ai")
  })

  test("rejects file URLs and unsupported protocols", () => {
    expect(resolveExternalURL("file:///tmp/index.html")).toBeUndefined()
    expect(resolveExternalURL("javascript:alert(1)")).toBeUndefined()
    expect(resolveExternalURL("data:text/html,hello")).toBeUndefined()
    expect(resolveExternalURL("not a url")).toBeUndefined()
  })

  test("resolves only local file URLs", () => {
    const path = resolve("example.html")
    expect(resolveLocalFilePath(pathToFileURL(path).href)).toBe(path)
    expect(resolveLocalFilePath("file://example.com/share/index.html")).toBeUndefined()
    expect(resolveLocalFilePath("https://example.com/index.html")).toBeUndefined()
  })

  test("redacts URLs for logging", () => {
    expect(redactURL("https://example.com/a/b?auth_token=secret#frag")).toBe("https://example.com")
    expect(redactURL("http://user:pass@127.0.0.1:4096/x?auth_token=secret")).toBe("http://127.0.0.1:4096")
    expect(redactURL("file:///home/me/secret.txt?auth_token=secret")).toBe("file:")
    expect(redactURL("oc://renderer/index.html?auth_token=secret")).toBe("oc://renderer")
    expect(redactURL("mailto:someone@example.com")).toBe("mailto:")
    expect(redactURL("javascript:alert('auth_token=secret')")).toBe("javascript:")
    expect(redactURL("not a url auth_token=secret")).toBe(unparseableURL)
  })
})
