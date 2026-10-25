import { createMemo, createEffect, createSignal, on, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useSync } from "@/context/sync"
import { checksum } from "@opencode-ai/core/util/encode"
import { findLast } from "@opencode-ai/core/util/array"
import { same } from "@/utils/same"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { AccordionV2 } from "@opencode-ai/ui/v2/accordion-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { File } from "@opencode-ai/session-ui/file"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import type { Message, Part, ToolPart, UserMessage } from "@opencode-ai/sdk/v2/client"
import { summarizeTurn } from "@opencode-ai/session-ui/step-kind"
import { Harness } from "@opencode-ai/schema/harness"
import { showToast } from "@/utils/toast"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { getSessionContext, getSessionHarnesses } from "./session-context-metrics"
import { estimateSessionContextBreakdown, type SessionContextBreakdownKey } from "./session-context-breakdown"
import { createSessionContextFormatter } from "./session-context-format"
import { getSessionUsage } from "./session-usage"
import { stepCountPhrases } from "./turn-steps-summary"

// User and assistant turns share one "Messages" segment, as in the Thread design; tones of the accent, not hues.
type BreakdownGroup = "system" | "messages" | "tool" | "other"
const BREAKDOWN_COLOR: Record<BreakdownGroup, string> = {
  system: "var(--v2-background-bg-accent)",
  messages: "color-mix(in srgb, var(--v2-background-bg-accent) 50%, var(--v2-background-bg-layer-02))",
  tool: "var(--v2-background-bg-layer-03)",
  other: "color-mix(in srgb, var(--v2-text-text-faint) 45%, transparent)",
}
const breakdownGroup = (key: SessionContextBreakdownKey): BreakdownGroup =>
  key === "user" || key === "assistant" ? "messages" : key

function Stat(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-col gap-0.5 rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2.5">
      <div class="truncate text-[11px] leading-4 text-v2-text-text-muted">{props.label}</div>
      <div class="truncate text-[15px] leading-5 text-v2-text-text-base [font-weight:560]">{props.value}</div>
    </div>
  )
}

function SectionLabel(props: { children: JSX.Element }) {
  return <div class="pl-1 text-[12px] text-v2-text-text-muted [font-weight:530]">{props.children}</div>
}

function RawMessageContent(props: { message: Message; getParts: (id: string) => Part[]; onRendered: () => void }) {
  const file = createMemo(() => {
    const parts = props.getParts(props.message.id)
    const contents = JSON.stringify({ message: props.message, parts }, null, 2)
    return {
      name: `${props.message.role}-${props.message.id}.json`,
      contents,
      cacheKey: checksum(contents),
    }
  })

  return (
    <File
      mode="text"
      file={file()}
      overflow="wrap"
      class="select-text"
      onRendered={() => requestAnimationFrame(props.onRendered)}
    />
  )
}

function RawMessage(props: {
  message: Message
  getParts: (id: string) => Part[]
  onRendered: () => void
  time: (value: number | string | undefined) => string
}) {
  return (
    <AccordionV2.Item value={props.message.id}>
      <AccordionV2.Header>
        <AccordionV2.Trigger>
          <div class="flex w-full min-w-0 items-center justify-between gap-2">
            <div class="min-w-0 truncate [font-weight:530]">
              {props.message.role} <span class="text-v2-text-text-muted [font-weight:400]">• {props.message.id}</span>
            </div>
            <div class="shrink-0 text-[12px] text-v2-text-text-muted">{props.time(props.message.time.created)}</div>
          </div>
        </AccordionV2.Trigger>
      </AccordionV2.Header>
      <AccordionV2.Content>
        <div class="px-3 pb-3">
          <RawMessageContent message={props.message} getParts={props.getParts} onRendered={props.onRendered} />
        </div>
      </AccordionV2.Content>
    </AccordionV2.Item>
  )
}

const emptyMessages: Message[] = []
const emptyUserMessages: UserMessage[] = []

export function SessionContextTab() {
  const sync = useSync()
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useSDK()
  const providers = useProviders(() => sdk().directory)
  const { params, view } = useSessionLayout()

  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))

  const messages = createMemo(
    () => {
      const id = params.id
      if (!id) return emptyMessages
      return (sync().data.message[id] ?? []) as Message[]
    },
    emptyMessages,
    { equals: same },
  )

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )

  const visibleUserMessages = createMemo(
    () => {
      const revert = info()?.revert?.messageID
      if (!revert) return userMessages()
      const boundary = userMessages().findIndex((message) => message.id === revert)
      return boundary < 0 ? userMessages() : userMessages().slice(0, boundary)
    },
    emptyUserMessages,
    { equals: same },
  )

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const getParts = (id: string) => (sync().data.part[id] ?? []) as Part[]
  const harnesses = createMemo(() => getSessionHarnesses(messages()))
  const [selectedHarness, setSelectedHarness] = createSignal<string>()
  createEffect(() => {
    const available = harnesses()
    if (available.includes(selectedHarness() ?? "")) return
    setSelectedHarness(available.at(-1))
  })
  const harnessLabel = (id: string) => {
    if (id === Harness.OpenCode) return language.t("harness.tenonWorkbench")
    if (id === Harness.OpenCodeAcp) return language.t("harness.openCode")
    if (id === Harness.Codex) return language.t("harness.codex")
    return id
  }
  const harnessOptions = createMemo(() => harnesses().map((id) => ({ id, label: harnessLabel(id) })))
  const ctx = createMemo(() => getSessionContext(messages(), [...providers.all().values()], selectedHarness()))
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))

  const usage = createMemo(() => getSessionUsage(messages(), { harness: selectedHarness() }))
  const harnessParts = createMemo(() =>
    messages()
      .filter(
        (message) =>
          message.role === "assistant" &&
          (!selectedHarness() ||
            ((message as Message & { harnessInstanceID?: string }).harnessInstanceID ?? Harness.OpenCode) ===
              selectedHarness()),
      )
      .flatMap((message) => getParts(message.id)),
  )
  const toolPhrases = createMemo(() => stepCountPhrases(language, summarizeTurn(harnessParts()).counts))
  // Built-in `task` subagents; Codex and ACP don't expose theirs.
  const subagents = createMemo(() =>
    harnessParts().flatMap((part) => {
      if (part.type !== "tool" || part.tool !== "task") return []
      const tool = part as ToolPart
      const input = tool.state.input ?? {}
      const metadata = ("metadata" in tool.state ? tool.state.metadata : undefined) ?? {}
      const sessionID = typeof metadata.sessionId === "string" ? metadata.sessionId : undefined
      const description = typeof input.description === "string" ? input.description : undefined
      return [
        {
          id: tool.id,
          title: description ?? (sessionID ? sync().session.get(sessionID)?.title : undefined) ?? tool.tool,
          agent: typeof input.subagent_type === "string" ? input.subagent_type : undefined,
          status: tool.state.status,
        },
      ]
    }),
  )
  const counts = createMemo(() => {
    const all = messages()
    const user = all.reduce((count, x) => count + (x.role === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, x) => count + (x.role === "assistant" ? 1 : 0), 0)
    return {
      all: all.length,
      user,
      assistant,
    }
  })

  const systemPrompt = createMemo(() => {
    const msg = findLast(visibleUserMessages(), (m) => !!m.system)
    const system = msg?.system
    if (!system) return
    const trimmed = system.trim()
    if (!trimmed) return
    return trimmed
  })

  const providerLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.providerLabel
  })

  const modelLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.modelLabel
  })

  const breakdown = createMemo(
    on(
      () => [ctx()?.message.id, ctx()?.input, messages().length, systemPrompt()],
      () => {
        const c = ctx()
        if (!c?.input) return []
        return estimateSessionContextBreakdown({
          messages: messages(),
          parts: sync().data.part as Record<string, Part[] | undefined>,
          input: c.input,
          systemPrompt: systemPrompt(),
        })
      },
    ),
  )

  const breakdownGroups = createMemo(() => {
    const groups = new Map<BreakdownGroup, { width: number; percent: number }>()
    for (const segment of breakdown()) {
      const key = breakdownGroup(segment.key)
      const current = groups.get(key) ?? { width: 0, percent: 0 }
      groups.set(key, { width: current.width + segment.width, percent: current.percent + segment.percent })
    }
    return [...groups].map(([key, value]) => ({ key, ...value }))
  })

  const breakdownLabel = (key: BreakdownGroup) => {
    if (key === "system") return language.t("context.breakdown.system")
    if (key === "messages") return language.t("context.stats.messages")
    if (key === "tool") return language.t("context.breakdown.tool")
    return language.t("context.breakdown.other")
  }

  const tiles = [
    { label: "secondBrain.sessionTab.tokens", value: () => formatter().number(ctx()?.total) },
    {
      label: "secondBrain.sessionTab.contextShare",
      value: () => (ctx()?.limit ? formatter().percent(ctx()?.usage) : "—"),
    },
    { label: "context.stats.messages", value: () => counts().all.toLocaleString(language.intl()) },
    {
      label: "harness.label",
      value: () => (selectedHarness() ? harnessLabel(selectedHarness()!) : "—"),
    },
  ] satisfies { label: string; value: () => JSX.Element }[]

  // Only what the harness reported; a missing value hides its row instead of reading "Not reported".
  const details = createMemo(() => {
    const c = ctx()
    const u = usage()
    const rows: { label: Parameters<typeof language.t>[0]; value: string | undefined }[] = [
      { label: "context.stats.model", value: c ? modelLabel() : undefined },
      { label: "context.stats.provider", value: c ? providerLabel() : undefined },
      {
        label: "secondBrain.sessionTab.contextWindow",
        value: c?.limit
          ? language.t("secondBrain.sessionTab.contextUsed", {
              used: formatter().number(c.total),
              limit: formatter().number(c.limit),
            })
          : undefined,
      },
      { label: "secondBrain.sessionTab.input", value: u.input > 0 ? formatter().number(u.input) : undefined },
      { label: "secondBrain.sessionTab.output", value: u.output > 0 ? formatter().number(u.output) : undefined },
      {
        label: "context.stats.reasoningTokens",
        value: u.reasoning > 0 ? formatter().number(u.reasoning) : undefined,
      },
      {
        label: "secondBrain.sessionTab.cacheHit",
        value:
          u.cacheHit === undefined
            ? undefined
            : u.cacheHit.toLocaleString(language.intl(), { style: "percent", maximumFractionDigits: 0 }),
      },
      { label: "secondBrain.sessionTab.cost", value: u.cost === undefined ? undefined : usd().format(u.cost) },
      {
        label: "context.stats.sessionCreated",
        value: info()?.time.created ? formatter().time(info()?.time.created) : undefined,
      },
      {
        label: "context.stats.lastActivity",
        value: c ? formatter().time(c.message.time.created) : undefined,
      },
    ]
    return rows.flatMap((row) => (row.value ? [{ label: row.label, value: row.value }] : []))
  })

  const [raw, setRaw] = createSignal(false)

  const exportSession = async () => {
    const sessionID = params.id
    if (!sessionID) return
    try {
      const data = await fetchSessionExport({
        sessionID,
        client: sdk().client,
        messageApi: (await sdk().protocol) === "v2" ? sdk().api.message : undefined,
      })
      const filename = sessionExportFilename(data.info)
      if (!platform.saveSessionExport) {
        downloadSessionExport(filename, data)
        return // Browsers cannot report whether the save dialog completed.
      }
      if (!(await platform.saveSessionExport({ filename, json: JSON.stringify(data, null, 2) }))) return
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = view().scroll("context")
    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return

      view().setScroll("context", next)
    })
  }

  createEffect(
    on(
      () => messages().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <ScrollView
      class="@container h-full"
      viewportRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <div class="px-4 pt-2 pb-10 flex flex-col gap-4">
        <Show when={harnessOptions().length > 1}>
          <div class="flex items-center justify-between gap-3 rounded-[16px] bg-v2-background-bg-layer-01 py-1.5 pl-3 pr-1.5">
            <div class="text-[12px] text-v2-text-text-muted">{language.t("harness.label")}</div>
            <SelectV2
              appearance="inline"
              options={harnessOptions()}
              current={harnessOptions().find((item) => item.id === selectedHarness())}
              value={(item) => item.id}
              label={(item) => item.label}
              placement="bottom-end"
              gutter={6}
              onSelect={(item) => item && setSelectedHarness(item.id)}
            />
          </div>
        </Show>

        <div class="grid grid-cols-2 gap-2">
          <For each={tiles}>
            {(tile) => <Stat label={language.t(tile.label as Parameters<typeof language.t>[0])} value={tile.value()} />}
          </For>
        </div>

        <Show when={breakdownGroups().length > 0}>
          <div data-slot="session-tab-context" class="flex flex-col gap-2">
            <SectionLabel>{language.t("context.breakdown.title")}</SectionLabel>
            <div class="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
              <For each={breakdownGroups()}>
                {(segment) => (
                  <div
                    class="h-full"
                    style={{ width: `${segment.width}%`, "background-color": BREAKDOWN_COLOR[segment.key] }}
                  />
                )}
              </For>
            </div>
            <div class="flex flex-wrap gap-x-3.5 gap-y-1 pl-1">
              <For each={breakdownGroups()}>
                {(segment) => (
                  <div class="flex items-center gap-1.5 text-[11.5px] text-v2-text-text-muted">
                    <div class="size-2 rounded-full" style={{ "background-color": BREAKDOWN_COLOR[segment.key] }} />
                    <div>{breakdownLabel(segment.key)}</div>
                    <div class="text-v2-text-text-faint">
                      {Math.round(segment.percent).toLocaleString(language.intl())}%
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={details().length > 0}>
          <div data-slot="session-tab-details" class="flex flex-col gap-2">
            <SectionLabel>{language.t("secondBrain.sessionTab.details")}</SectionLabel>
            <dl class="m-0 flex flex-col rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-1">
              <For each={details()}>
                {(row) => (
                  <div class="flex min-h-8 items-center justify-between gap-3 text-[13px]">
                    <dt class="shrink-0 text-v2-text-text-muted">{language.t(row.label)}</dt>
                    <dd class="m-0 min-w-0 truncate text-right text-v2-text-text-base [font-variant-numeric:tabular-nums]">
                      {row.value}
                    </dd>
                  </div>
                )}
              </For>
            </dl>
          </div>
        </Show>

        <Show when={subagents().length > 0}>
          <div data-slot="session-tab-subagents" class="flex flex-col gap-2">
            <SectionLabel>{language.t("secondBrain.sessionTab.subagents")}</SectionLabel>
            <div class="flex flex-col gap-1">
              <For each={subagents()}>
                {(agent) => (
                  <div
                    class="flex min-w-0 items-center gap-2 rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2 text-[13px]"
                    data-status={agent.status}
                  >
                    <span class="min-w-0 flex-1 truncate text-v2-text-text-base">{agent.title}</span>
                    <Show when={agent.agent}>
                      <span class="shrink-0 text-v2-text-text-muted">{agent.agent}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={toolPhrases().length > 0}>
          <div data-slot="session-tab-tools" class="flex flex-col gap-2">
            <SectionLabel>{language.t("secondBrain.sessionTab.tools")}</SectionLabel>
            <div class="flex flex-wrap gap-1.5">
              <For each={toolPhrases()}>
                {(phrase) => (
                  <span class="rounded-full bg-v2-background-bg-layer-01 px-2.5 py-1 text-[12px] text-v2-text-text-base">
                    {phrase}
                  </span>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <div class="flex flex-col gap-2">
              <SectionLabel>{language.t("context.systemPrompt.title")}</SectionLabel>
              <div class="rounded-[16px] bg-v2-background-bg-layer-01 px-4 py-2.5">
                <Markdown text={prompt()} class="text-[12px]" />
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <ButtonV2 variant="outline" size="small" aria-expanded={raw()} onClick={() => setRaw((value) => !value)}>
              {language.t("context.rawMessages.title")}
            </ButtonV2>
            <ButtonV2 variant="ghost" size="small" class="gap-1.5" onClick={exportSession}>
              <Icon name="download" />
              <span>{language.t("context.export.session")}</span>
            </ButtonV2>
          </div>
          <Show when={raw()}>
            <AccordionV2 multiple class="thread-collapsibles">
              <For each={messages()}>
                {(message) => (
                  <RawMessage
                    message={message}
                    getParts={getParts}
                    onRendered={restoreScroll}
                    time={formatter().time}
                  />
                )}
              </For>
            </AccordionV2>
          </Show>
        </div>
      </div>
    </ScrollView>
  )
}
