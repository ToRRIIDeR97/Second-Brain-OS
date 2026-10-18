import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import { Harness } from "@opencode-ai/schema/harness"

// Session-wide totals. Unlike getSessionContext, which reads the last message,
// this sums every assistant message, optionally for one harness.
export function getSessionUsage(messages: Message[], options?: { harness?: string }) {
  const counted = messages.filter(
    (message): message is AssistantMessage =>
      message.role === "assistant" &&
      (!options?.harness ||
        ((message as AssistantMessage & { harnessInstanceID?: string }).harnessInstanceID ?? Harness.OpenCode) ===
          options.harness),
  )
  const sum = (pick: (message: AssistantMessage) => number) =>
    counted.reduce((total, message) => total + pick(message), 0)
  const input = sum((message) => message.tokens.input)
  const cacheRead = sum((message) => message.tokens.cache.read)
  const cacheWrite = sum((message) => message.tokens.cache.write)
  const inputSide = input + cacheRead + cacheWrite
  // A cost of 0 (or a missing field) means the harness did not report one.
  const reported = counted.filter((message) => typeof message.cost === "number" && message.cost > 0)
  return {
    input,
    output: sum((message) => message.tokens.output),
    reasoning: sum((message) => message.tokens.reasoning),
    cacheRead,
    cacheWrite,
    cacheHit: inputSide > 0 ? cacheRead / inputSide : undefined,
    cost: reported.length > 0 ? reported.reduce((total, message) => total + message.cost, 0) : undefined,
  }
}
