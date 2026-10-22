import { For, Match, Show, Switch, createMemo, createSignal, type JSX } from "solid-js"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { Harness } from "@opencode-ai/schema/harness"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionContextFormatter } from "./session-context-format"
import { subagentDetail, type SubagentTranscriptEntry } from "./subagent-detail"

type View = "conversation" | "context" | "usage"

/** The `acp_subagent` tool part behind an agent tab, with the harness that ran it, from the open session. */
export function useSubagentPart(partID: () => string) {
  const sync = useSync()
  const { params } = useSessionLayout()
  return createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return undefined
    const messages = sync().data.message[sessionID] ?? []
    for (const message of messages) {
      const part = sync().data.part[message.id]?.find((item) => item.id === partID())
      if (part?.type !== "tool") continue
      return {
        part,
        harness: (message as Message & { harnessInstanceID?: string }).harnessInstanceID,
      }
    }
    return undefined
  })
}

const running = (status: string | undefined) => status === "pending" || status === "running"

/** Agent tab trigger content: the agent's name and a running indicator. */
export function SubagentTabLabel(props: { partID: string }) {
  const language = useLanguage()
  const found = useSubagentPart(() => props.partID)
  const name = () => {
    const agent = found()?.part.state.input?.subagent_type
    return typeof agent === "string" && agent ? agent : language.t("secondBrain.agentTab.agentFallback")
  }
  return (
    <>
      <Show when={running(found()?.part.state.status)}>
        <LoaderV2 width={12} height={12} style={{ color: "var(--v2-icon-icon-accent)" }} />
      </Show>
      <span class="max-w-40 truncate">{name()}</span>
    </>
  )
}

export function SubagentTab(props: { partID: string }) {
  const language = useLanguage()
  const found = useSubagentPart(() => props.partID)
  const detail = createMemo(() => {
    const value = found()
    return value ? subagentDetail(value.part) : undefined
  })
  const [view, setView] = createSignal<View>("conversation")
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }))
  const percent = createMemo(
    () => new Intl.NumberFormat(language.intl(), { style: "percent", maximumFractionDigits: 0 }),
  )

  const harnessName = () => {
    const id = found()?.harness
    if (id === Harness.OpenCode) return language.t("harness.tenonWorkbench")
    if (id === Harness.OpenCodeAcp) return language.t("harness.openCode")
    if (id === Harness.Codex) return language.t("harness.codex")
    return language.t("secondBrain.agentTab.thisHarness")
  }
  const notReported = () => language.t("secondBrain.agentTab.notReported", { harness: harnessName() })
  const tokens = (value: number | undefined) => (value === undefined ? notReported() : formatter().number(value))
  const statusLabel = (status: string) => statusText(language, status)

  return (
    <Show
      when={detail()}
      fallback={
        <div class="h-full px-6 pb-42 flex flex-col items-center justify-center text-center">
          <div class="max-w-56 text-[13px] leading-5 text-v2-text-text-muted">
            {language.t("secondBrain.agentTab.missing")}
          </div>
        </div>
      }
    >
      {(item) => (
        <ScrollView class="@container h-full">
          <div class="px-4 pt-2 pb-10 flex flex-col gap-4">
            <div data-slot="agent-tab-heading" class="flex min-w-0 flex-col gap-0.5">
              <div class="flex min-w-0 items-center gap-1.5 text-[13px]">
                <Show when={running(item().status)}>
                  <LoaderV2 width={12} height={12} style={{ color: "var(--v2-icon-icon-accent)" }} />
                </Show>
                <span class="truncate text-v2-text-text-base [font-weight:530]">
                  {item().agent ?? language.t("secondBrain.agentTab.agentFallback")}
                </span>
                <span aria-hidden="true" class="text-v2-text-text-muted">
                  ·
                </span>
                <span class="shrink-0 text-v2-text-text-muted">{statusLabel(item().status)}</span>
              </div>
              <Show when={item().description}>
                {(description) => <div class="text-[13px] text-v2-text-text-muted">{description()}</div>}
              </Show>
            </div>

            <div class="grid grid-cols-3 gap-2">
              <Stat
                label={language.t("secondBrain.agentTab.context")}
                value={item().context?.percent === undefined ? "—" : formatter().percent(item().context?.percent)}
              />
              <Stat
                label={language.t("secondBrain.agentTab.tokens")}
                value={
                  item().usage.input === undefined && item().usage.output === undefined
                    ? "—"
                    : language.t("secondBrain.agentTab.tokensInOut", {
                        input: formatter().number(item().usage.input),
                        output: formatter().number(item().usage.output),
                      })
                }
              />
              <Stat
                label={language.t("secondBrain.sessionTab.cacheHit")}
                value={item().usage.cacheHit === undefined ? "—" : percent().format(item().usage.cacheHit!)}
              />
            </div>

            <SegmentedControlV2
              class="!w-auto self-start"
              value={view()}
              onChange={(value) => value && setView(value as View)}
            >
              <SegmentedControlItemV2 value="conversation">
                {language.t("secondBrain.agentTab.conversation")}
              </SegmentedControlItemV2>
              <SegmentedControlItemV2 value="context">
                {language.t("secondBrain.agentTab.context")}
              </SegmentedControlItemV2>
              <SegmentedControlItemV2 value="usage">{language.t("secondBrain.agentTab.usage")}</SegmentedControlItemV2>
            </SegmentedControlV2>

            <Switch>
              <Match when={view() === "conversation"}>
                <div data-slot="agent-tab-conversation" class="flex flex-col gap-3">
                  <Show when={item().prompt}>
                    {(prompt) => (
                      <div class="flex flex-col gap-1 rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2.5">
                        <div class="text-[11px] leading-4 text-v2-text-text-muted">
                          {language.t("secondBrain.agentTab.prompt")}
                        </div>
                        <div class="whitespace-pre-wrap break-words text-[13px] text-v2-text-text-base">{prompt()}</div>
                      </div>
                    )}
                  </Show>
                  <For each={item().transcript}>{(entry) => <TranscriptEntry entry={entry} />}</For>
                  <Show when={item().transcript.length === 0 && !item().prompt}>
                    <div class="text-[13px] text-v2-text-text-muted">{language.t("secondBrain.agentTab.empty")}</div>
                  </Show>
                  <Show when={item().truncated}>
                    <div class="text-[12px] text-v2-text-text-muted">
                      {language.t("secondBrain.agentTab.truncated")}
                    </div>
                  </Show>
                </div>
              </Match>
              <Match when={view() === "context"}>
                <div class="flex flex-col gap-2 rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2.5">
                  <div class="flex items-center justify-between gap-3 text-[11px] leading-4 text-v2-text-text-muted">
                    <span>{language.t("secondBrain.sessionTab.contextWindow")}</span>
                    <Show when={item().context?.percent !== undefined}>
                      <span>{formatter().percent(item().context?.percent)}</span>
                    </Show>
                  </div>
                  <div class="text-[15px] leading-5 text-v2-text-text-base [font-weight:560]">
                    <Show when={item().context} fallback={notReported()}>
                      {(context) =>
                        context().size === undefined
                          ? language.t("secondBrain.agentTab.contextUsedOnly", {
                              used: formatter().number(context().used),
                            })
                          : language.t("secondBrain.sessionTab.contextUsed", {
                              used: formatter().number(context().used),
                              limit: formatter().number(context().size),
                            })
                      }
                    </Show>
                  </div>
                  <Show when={item().context?.percent}>
                    {(value) => (
                      <div class="h-1.5 w-full overflow-hidden rounded-full bg-v2-background-bg-layer-02">
                        <div
                          class="h-full rounded-full bg-v2-background-bg-accent"
                          style={{ width: `${Math.min(100, value())}%` }}
                        />
                      </div>
                    )}
                  </Show>
                </div>
              </Match>
              <Match when={view() === "usage"}>
                <div class="grid grid-cols-2 gap-2">
                  <Stat label={language.t("secondBrain.sessionTab.input")} value={tokens(item().usage.input)} />
                  <Stat label={language.t("secondBrain.sessionTab.output")} value={tokens(item().usage.output)} />
                  <Stat label={language.t("secondBrain.agentTab.reasoning")} value={tokens(item().usage.reasoning)} />
                  <Stat label={language.t("secondBrain.agentTab.cacheRead")} value={tokens(item().usage.cacheRead)} />
                  <Stat label={language.t("secondBrain.agentTab.cacheWrite")} value={tokens(item().usage.cacheWrite)} />
                  <Stat
                    label={language.t("secondBrain.sessionTab.cacheHit")}
                    value={
                      item().usage.cacheHit === undefined ? notReported() : percent().format(item().usage.cacheHit!)
                    }
                  />
                  <Stat
                    label={language.t("secondBrain.sessionTab.cost")}
                    value={item().usage.cost === undefined ? notReported() : usd().format(item().usage.cost!)}
                  />
                </div>
              </Match>
            </Switch>
          </div>
        </ScrollView>
      )}
    </Show>
  )
}

function TranscriptEntry(props: { entry: SubagentTranscriptEntry }) {
  const language = useLanguage()
  return (
    <Switch>
      <Match when={props.entry.type === "text" && props.entry}>
        {(entry) => (
          <div class="text-[13px] text-v2-text-text-base">
            <Markdown text={(entry() as { text: string }).text} />
          </div>
        )}
      </Match>
      <Match when={props.entry.type === "reasoning" && props.entry}>
        {(entry) => (
          <details class="text-[13px] text-v2-text-text-muted">
            <summary class="cursor-pointer select-none">{language.t("secondBrain.agentTab.reasoning")}</summary>
            <div class="mt-1 whitespace-pre-wrap break-words">{(entry() as { text: string }).text}</div>
          </details>
        )}
      </Match>
      <Match when={props.entry.type === "tool" && props.entry}>
        {(entry) => {
          const tool = () => entry() as Extract<SubagentTranscriptEntry, { type: "tool" }>
          const row = (
            <span class="flex min-w-0 items-center gap-2">
              <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-v2-text-text-base">
                {tool().title ?? tool().tool}
              </span>
              <span class="shrink-0 text-[12px] text-v2-text-text-muted">{statusText(language, tool().status)}</span>
            </span>
          )
          return (
            <div class="rounded-[12px] bg-v2-background-bg-layer-01 px-3 py-1.5">
              <Show when={tool().output} fallback={row}>
                {(output) => (
                  <details>
                    <summary class="cursor-pointer select-none">{row}</summary>
                    <pre class="mt-1.5 max-h-80 overflow-auto whitespace-pre-wrap break-words text-[12px] text-v2-text-text-muted">
                      {output()}
                    </pre>
                  </details>
                )}
              </Show>
            </div>
          )
        }}
      </Match>
    </Switch>
  )
}

/** Tool part statuses and ACP step statuses (`in_progress`, `failed`) share these labels. */
function statusText(language: ReturnType<typeof useLanguage>, status: string) {
  if (status === "pending") return language.t("secondBrain.agentTab.status.pending")
  if (status === "running" || status === "in_progress") return language.t("secondBrain.agentTab.status.running")
  if (status === "error" || status === "failed") return language.t("secondBrain.agentTab.status.error")
  return language.t("secondBrain.agentTab.status.completed")
}

function Stat(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-col gap-0.5 rounded-[16px] bg-v2-background-bg-layer-01 px-3 py-2.5">
      <div class="truncate text-[11px] leading-4 text-v2-text-text-muted">{props.label}</div>
      <div class="break-words text-[15px] leading-5 text-v2-text-text-base [font-weight:560]">{props.value}</div>
    </div>
  )
}
