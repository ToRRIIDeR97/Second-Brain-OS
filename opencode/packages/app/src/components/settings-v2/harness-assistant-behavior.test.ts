import { describe, expect, test } from "bun:test"
import {
  displayedUserText,
  parseProposal,
  proposalKey,
  setupInstructions,
  testResultMessage,
  testResultPrefix,
} from "./harness-assistant-behavior"

const block = (json: string) => "```harness\n" + json + "\n```"

describe("harness assistant behavior", () => {
  test("parses the last valid harness block", () => {
    const text = [
      "First try:",
      block('{"id":"old","command":"/bin/old","args":[]}'),
      "Better:",
      block('{"id":"agy","name":"Antigravity","command":"/usr/local/bin/agy","args":["acp"],"model":"m1"}'),
    ].join("\n")
    expect(parseProposal(text)).toEqual({
      id: "agy",
      name: "Antigravity",
      command: "/usr/local/bin/agy",
      args: ["acp"],
      model: "m1",
    })
  })

  test("skips invalid blocks and falls back to an earlier valid one", () => {
    const text = [
      block('{"id":"good","command":"agy","args":["acp"]}'),
      block('{"id":"1 bad","command":"agy","args":["acp"]}'),
      block("not json"),
      block('{"id":"noargs","command":"agy","args":[1]}'),
    ].join("\n")
    expect(parseProposal(text)?.id).toBe("good")
    expect(parseProposal("no block here")).toBeUndefined()
    expect(parseProposal(block('{"id":"x","command":"  ","args":[]}'))).toBeUndefined()
  })

  test("a changed name keeps the same proposal key", () => {
    const a = parseProposal(block('{"id":"a","name":"A","command":"agy","args":["acp"]}'))!
    const b = parseProposal(block('{"id":"a","name":"Renamed","command":"agy","args":["acp"]}'))!
    const c = parseProposal(block('{"id":"a","command":"agy","args":["--acp"]}'))!
    expect(proposalKey(a)).toBe(proposalKey(b))
    expect(proposalKey(a)).not.toBe(proposalKey(c))
  })

  test("the first message hides the instructions in the chat", () => {
    const text = setupInstructions("add antigravity")
    expect(text).toContain("```harness")
    expect(displayedUserText(text)).toBe("add antigravity")
    expect(displayedUserText("plain follow-up")).toBe("plain follow-up")
  })

  test("test results tell the assistant what happened", () => {
    expect(testResultMessage({ error: "agy did not complete an ACP handshake" })).toStartWith(
      `${testResultPrefix} FAILED.`,
    )
    const verification = {
      command: "/bin/agy",
      args: ["acp"],
      agentName: "Antigravity",
      models: [],
      reply: "",
      ok: false,
    }
    expect(testResultMessage({ verification })).toContain("returned no text")
    const withModels = testResultMessage({
      verification: {
        ...verification,
        models: [{ id: "m1", name: "M1", reasoningEfforts: [], serviceTiers: [], isDefault: true }],
      },
    })
    expect(withModels).toContain('Add "model" with one of the IDs it offers: m1.')
    expect(testResultMessage({ verification: { ...verification, reply: "harness ok", ok: true } })).toBe(
      `${testResultPrefix} PASSED. Antigravity answered "harness ok" and offers 0 models.`,
    )
  })
})
