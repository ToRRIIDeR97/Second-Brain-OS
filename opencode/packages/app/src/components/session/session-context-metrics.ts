import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import { Harness } from "@opencode-ai/schema/harness"

type HarnessAssistant = AssistantMessage & { harnessInstanceID?: string }

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  total: number
  usage: number | null
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const harnessID = (message: AssistantMessage) => (message as HarnessAssistant).harnessInstanceID ?? Harness.OpenCode

export const getSessionHarnesses = (messages: Message[] = []) =>
  [
    ...new Set(messages.flatMap((message) => (message.role === "assistant" ? [harnessID(message)] : [])).reverse()),
  ].reverse()

const lastAssistantWithTokens = (messages: Message[], selectedHarness?: string) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (selectedHarness && harnessID(msg) !== selectedHarness) continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
}

const build = (messages: Message[] = [], providers: Provider[] = [], selectedHarness?: string): Context | undefined => {
  const message = lastAssistantWithTokens(messages, selectedHarness)
  if (!message) return undefined

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    message,
    provider,
    model,
    providerLabel: provider?.name ?? message.providerID,
    modelLabel: model?.name ?? message.modelID,
    limit,
    input: message.tokens.input,
    total,
    usage: limit ? Math.round((total / limit) * 100) : null,
  }
}

export function getSessionContext(messages: Message[] = [], providers: Provider[] = [], selectedHarness?: string) {
  return build(messages, providers, selectedHarness)
}
