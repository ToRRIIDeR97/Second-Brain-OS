import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Icon as StepIcon } from "@opencode-ai/ui/icon"
import {
  stepIcon,
  stepOf,
  stepVerbKey,
  summarizeTurn,
  type StepKind,
  type TurnSteps,
} from "@opencode-ai/session-ui/step-kind"
import { useLanguage } from "@/context/language"

// Fixed order so the phrase list doesn't reshuffle while a turn streams.
const KIND_ORDER: StepKind[] = [
  "read",
  "search",
  "edit",
  "run",
  "fetch",
  "mcp",
  "skill",
  "subagent",
  "todo",
  "question",
  "other",
]

/** One complete localized phrase per step kind that occurred, e.g. "Read 3 files". */
export function stepCountPhrases(language: ReturnType<typeof useLanguage>, counts: TurnSteps["counts"]) {
  return KIND_ORDER.flatMap((kind) => {
    const count = counts[kind]
    if (!count) return []
    return [language.plural(`secondBrain.turnSteps.${kind}`, count, { count: count.toLocaleString(language.intl()) })]
  })
}

const TICKER_SIZE = 3
const isRunning = (part: ToolPart) => part.state.status === "pending" || part.state.status === "running"

/** The latest in-progress step and the steps just before it, oldest first; the last steps when none is running. */
export function tickerSteps(parts: readonly Part[]) {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  const current = tools.findLastIndex(isRunning)
  const end = current === -1 ? tools.length : current + 1
  return tools.slice(Math.max(0, end - TICKER_SIZE), end)
}

export function formatTurnDuration(language: ReturnType<typeof useLanguage>, ms: number | undefined) {
  if (ms === undefined || !(ms >= 0)) return
  const total = Math.round(ms / 1000)
  const number = (value: number) => value.toLocaleString(language.intl())
  if (total < 60) return language.t("ui.message.duration.seconds", { count: number(total) })
  return language.t("ui.message.duration.minutesSeconds", {
    minutes: number(Math.floor(total / 60)),
    seconds: number(total % 60),
  })
}

export function TurnStepsSummary(props: {
  parts: Part[]
  working: boolean
  startedAt?: number
  durationMs?: number
  open: boolean
  onToggle: (open: boolean) => void
}) {
  const language = useLanguage()
  const summary = createMemo(() => summarizeTurn(props.parts))
  const phrases = createMemo(() => stepCountPhrases(language, summary().counts))
  const toolCount = createMemo(() => props.parts.filter((part) => part.type === "tool").length)
  const ticker = createMemo(() => (props.working && !props.open ? tickerSteps(props.parts) : []))
  // One clock drives the turn and step timers; it only ticks while the turn works.
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => props.working && setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))
  const elapsed = (start: number | undefined) =>
    start === undefined ? undefined : formatTurnDuration(language, Math.max(0, now() - start))
  const title = () => {
    if (props.working) {
      const duration = elapsed(props.startedAt)
      return duration
        ? language.t("secondBrain.turnSteps.workingFor", { duration })
        : language.t("secondBrain.turnSteps.working")
    }
    const duration = formatTurnDuration(language, props.durationMs)
    if (!duration) return language.t("secondBrain.turnSteps.workedNoDuration")
    return language.t("secondBrain.turnSteps.worked", { duration })
  }

  const label = (part: ToolPart) => {
    const step = stepOf(part)
    // Subagent rows show the agent's own name, which is data rather than copy.
    const agent = part.state.input?.subagent_type
    if (step.kind === "subagent" && typeof agent === "string" && agent) return agent
    return language.t(stepVerbKey(step.kind, isRunning(part)))
  }
  const startOf = (part: ToolPart) => (part.state.status === "running" ? part.state.time.start : undefined)

  return (
    <div data-slot="turn-steps" class="flex w-full min-w-0 flex-col rounded-[16px] bg-v2-background-bg-layer-01">
      <button
        type="button"
        data-component="turn-steps-summary"
        data-state={props.open ? "open" : "closed"}
        data-working={props.working ? "" : undefined}
        aria-expanded={props.open}
        class="flex h-9 w-full min-w-0 items-center gap-2 rounded-[16px] px-3 text-left text-[14px] leading-5 text-v2-text-text-base"
        onClick={() => props.onToggle(!props.open)}
      >
        <span data-slot="turn-steps-title" class="shrink-0 [font-weight:500] tabular-nums">
          {title()}
        </span>
        <span
          data-slot="turn-steps-counts"
          class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-muted"
        >
          <For each={phrases()}>
            {(phrase, index) => (
              <>
                <Show when={index() > 0}>
                  <span aria-hidden="true"> · </span>
                </Show>
                <span>{phrase}</span>
              </>
            )}
          </For>
        </span>
        <Show when={summary().failed > 0}>
          <span data-slot="turn-steps-failed" class="shrink-0 text-v2-text-text-critical">
            {language.plural("secondBrain.turnSteps.failed", summary().failed, {
              count: summary().failed.toLocaleString(language.intl()),
            })}
          </span>
        </Show>
        <Show when={ticker().length > 0 && toolCount() > ticker().length}>
          <span data-slot="turn-steps-show-all" class="shrink-0 text-[13px] text-v2-text-text-accent">
            {language.t("secondBrain.turnSteps.showAll", { count: toolCount().toLocaleString(language.intl()) })}
          </span>
        </Show>
        <Icon
          name={props.open ? "chevron-down" : "chevron-right"}
          size="small"
          class="shrink-0 text-v2-text-text-muted"
        />
      </button>
      <Show when={ticker().length > 0}>
        {/* Fixed height while the turn works, so steps starting and finishing never move the rows below. */}
        <ol
          data-slot="turn-steps-ticker"
          aria-live="polite"
          class="flex h-[84px] flex-col gap-1 overflow-hidden px-3 pb-2 text-[13px] leading-5"
        >
          <For each={ticker()}>
            {(part) => {
              const running = () => isRunning(part)
              const step = () => stepOf(part)
              return (
                <li
                  data-slot="turn-steps-ticker-step"
                  data-running={running() ? "" : undefined}
                  class="flex min-w-0 shrink-0 items-center gap-2"
                  classList={{
                    "text-v2-text-text-muted": !running(),
                    "-mx-2 h-8 rounded-[12px] bg-v2-background-bg-base px-2 text-v2-text-text-base": running(),
                  }}
                >
                  <Show
                    when={running()}
                    fallback={<StepIcon name={stepIcon(step().kind)} size="small" class="shrink-0" />}
                  >
                    <span
                      aria-hidden="true"
                      class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-v2-border-border-muted border-t-v2-icon-icon-accent motion-reduce:animate-none"
                    />
                  </Show>
                  <span class="shrink-0 [font-weight:500]">{label(part)}</span>
                  <Show when={step().target}>
                    {(target) => <span class="min-w-0 truncate font-mono text-[12px]">{target()}</span>}
                  </Show>
                  <span class="flex-1" />
                  <Show when={running() && elapsed(startOf(part))}>
                    {(time) => <span class="shrink-0 tabular-nums text-v2-text-text-muted">{time()}</span>}
                  </Show>
                </li>
              )
            }}
          </For>
        </ol>
      </Show>
    </div>
  )
}
