import type { Harness } from "@opencode-ai/schema/harness"
import { Option, Schema } from "effect"

export type HarnessProposal = {
  id: string
  name?: string
  command: string
  args: string[]
  model?: string
}

// Marks messages the app sends into the chat, so they render as status instead of user text.
export const testResultPrefix = "Second Brain test result:"
const requestMarker = "\n\nRequest: "

/**
 * The assistant can run on any harness. ACP agents receive no Second Brain system prompt, so the
 * task instructions travel inside the first user message.
 */
export function setupInstructions(request: string) {
  return (
    [
      "You are helping me set up an agent CLI as a harness in Second Brain OS.",
      "A harness is a command-line agent that Second Brain starts and talks to over the Agent Client Protocol (ACP) on stdio.",
      "Goal: find the exact command and arguments that start the requested agent in ACP mode on this computer.",
      "",
      "1. Check that the CLI is installed (for example `which <name>`), then read its help (`<name> --help`, `<name> acp --help`) or official docs to find its ACP mode. It is often a subcommand such as `acp` or a flag such as `--experimental-acp`.",
      "2. Do not install, configure, or sign in to anything. If the CLI is missing or needs sign-in, say so and give me the command to run myself.",
      "Only run quick checks such as `which`, `--help`, and `--version`. Do not write scripts or test the ACP connection yourself; Second Brain runs the test.",
      "3. When you know the command, reply with exactly one block like this and nothing after it:",
      "```harness",
      '{"id": "short-id", "name": "Display name", "command": "/absolute/path/to/cli", "args": ["acp"]}',
      "```",
      'Add "model" only if the agent needs a specific model ID to answer.',
      "4. Second Brain then tests it automatically (ACP handshake, model list, one short prompt) and sends you the result. If the test fails, use the result to fix the proposal and send a new block.",
      "Keep replies short.",
    ].join("\n") + `${requestMarker}${request}`
  )
}

/** The part of a user message to show in the chat: the request without the instructions. */
export function displayedUserText(text: string) {
  const index = text.indexOf(requestMarker)
  return text.startsWith("You are helping me set up an agent CLI") && index >= 0
    ? text.slice(index + requestMarker.length)
    : text
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const slug = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

/** The last valid ```harness block in an assistant reply, if any. */
export function parseProposal(text: string): HarnessProposal | undefined {
  const blocks = Array.from(text.matchAll(/```harness[^\n]*\n([\s\S]*?)```/g), (match) => match[1] ?? "")
  return blocks.reverse().flatMap((block) => {
    const record = Option.getOrUndefined(decodeJson(block.trim()))
    if (!isRecord(record)) return []
    const id = typeof record.id === "string" ? record.id.trim() : ""
    const command = typeof record.command === "string" ? record.command.trim() : ""
    const args = Array.isArray(record.args) ? record.args : []
    if (!slug.test(id) || !command || !args.every((arg): arg is string => typeof arg === "string")) return []
    return [
      {
        id,
        name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : undefined,
        command,
        args,
        model: typeof record.model === "string" && record.model.trim() ? record.model.trim() : undefined,
      },
    ]
  })[0]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Identity of a proposal's runnable part; a changed name alone doesn't need a new test. */
export const proposalKey = (proposal: HarnessProposal) =>
  JSON.stringify([proposal.command, proposal.args, proposal.model ?? ""])

/** Message sent back to the assistant after a test, so it can fix a failing proposal. */
export function testResultMessage(result: { verification?: Harness.Verification; error?: string }) {
  if (result.error) return `${testResultPrefix} FAILED. ${result.error}\nFix the proposal and send a new harness block.`
  const verification = result.verification
  if (!verification?.ok) {
    // An agent without a working default model often answers nothing; listing models lets the
    // assistant pick one instead of investigating further.
    const models = verification?.models.slice(0, 20).map((model) => model.id) ?? []
    const hint = models.length
      ? `\nIt may need a model. Add "model" with one of the IDs it offers: ${models.join(", ")}${verification && verification.models.length > models.length ? ", …" : ""}.`
      : ""
    return `${testResultPrefix} FAILED. The agent completed the ACP handshake but returned no text for the test prompt.${hint}\nFix the proposal and send a new harness block.`
  }
  return `${testResultPrefix} PASSED. ${verification.agentName ?? verification.command} answered "${verification.reply.slice(0, 200)}" and offers ${verification.models.length} models.`
}
