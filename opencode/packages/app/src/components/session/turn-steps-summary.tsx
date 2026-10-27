import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { Icon as StepIcon } from "@opencode-ai/ui/icon"
import {
  stepIcon,
  stepOf,
  stepVerbKey,
  summarizeTurn,
  toolStep,
  type StepKind,
  type TurnSteps,
} from "@opencode-ai/session-ui/step-kind"
import { useLanguage } from "@/context/language"
import "./turn-steps-summary.css"

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
  return stepCounts(counts).map((item) => stepCountPhrase(language, item.kind, item.count))
}

function stepCounts(counts: TurnSteps["counts"]) {
  return KIND_ORDER.flatMap((kind) => {
    const count = counts[kind]
    return count ? [{ kind, count }] : []
  })
}

function stepCountPhrase(language: ReturnType<typeof useLanguage>, kind: StepKind, count: number) {
  return language.plural(`secondBrain.turnSteps.${kind}`, count, { count: count.toLocaleString(language.intl()) })
}

const isRunning = (part: ToolPart) => part.state.status === "pending" || part.state.status === "running"
const isSubagent = (part: ToolPart) => stepOf(part).kind === "subagent"

/** The step the ticker shows: the latest one still in progress, else the latest one. Subagents have lanes instead. */
export function tickerStep(parts: readonly Part[]) {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool" && !isSubagent(part))
  return tools.findLast(isRunning) ?? tools.at(-1)
}

export interface LaneStep {
  readonly tool: string
  readonly title?: string
  readonly status: string
}

/** Subagents started in the turn, with the steps an ACP harness reported for each one. */
export function subagentLanes(parts: readonly Part[]) {
  return parts
    .filter((part): part is ToolPart => part.type === "tool" && isSubagent(part))
    .map((part) => {
      const steps = laneSteps(part.metadata?.acpSteps)
      return {
        part,
        steps,
        running: isRunning(part),
        // The newest step still going, else the newest one, so the lane reads as "what it's doing now".
        current: steps.findLast((step) => step.status === "pending" || step.status === "in_progress") ?? steps.at(-1),
      }
    })
}

function laneSteps(value: unknown): LaneStep[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) =>
    typeof item === "object" && item !== null && typeof item.tool === "string" && typeof item.status === "string"
      ? [{ tool: item.tool, status: item.status, title: typeof item.title === "string" ? item.title : undefined }]
      : [],
  )
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
  /** Opens a harness subagent's tab; its lanes become buttons when this is set. */
  onOpenSubagent?: (part: ToolPart) => void
}) {
  const language = useLanguage()
  const summary = createMemo(() => summarizeTurn(props.parts))
  const counts = createMemo(() => stepCounts(summary().counts))
  const live = () => props.working && !props.open
  const ticker = createMemo(() => (live() ? tickerStep(props.parts) : undefined))
  // Finished lanes stay, with a full bar, until the turn ends so parallel subagents don't jump around.
  const lanes = createMemo(() => (live() ? subagentLanes(props.parts) : []))
  // One clock drives the turn and step timers; it only ticks while the turn works.
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!props.working) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
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
  const openable = (part: ToolPart) => (part.tool === "acp_subagent" ? props.onOpenSubagent : undefined)
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
        <Show
          when={props.working}
          fallback={<Icon name="check" size="small" class="shrink-0 text-v2-text-text-muted" />}
        >
          <LoaderV2 width={14} height={14} class="text-v2-icon-icon-accent" />
        </Show>
        <span data-slot="turn-steps-title" class="shrink-0 [font-weight:500] tabular-nums">
          {title()}
        </span>
        <span data-slot="turn-steps-counts" class="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <For each={counts()}>
            {(item) => (
              <span
                data-slot="turn-steps-count"
                title={stepCountPhrase(language, item.kind, item.count)}
                class="flex h-5 shrink-0 items-center gap-1 rounded-full bg-v2-background-bg-base px-2 text-[12px] tabular-nums text-v2-text-text-muted"
              >
                <StepIcon name={stepIcon(item.kind)} size="small" aria-hidden="true" />
                <span aria-hidden="true">{item.count.toLocaleString(language.intl())}</span>
                <span class="sr-only">{stepCountPhrase(language, item.kind, item.count)}</span>
              </span>
            )}
          </For>
        </span>
        <Show when={summary().failed > 0}>
          <span data-slot="turn-steps-failed" class="shrink-0 text-[13px] text-v2-text-text-critical">
            {language.plural("secondBrain.turnSteps.failed", summary().failed, {
              count: summary().failed.toLocaleString(language.intl()),
            })}
          </span>
        </Show>
        <Icon
          name="chevron-right"
          size="small"
          class="shrink-0 text-v2-text-text-muted transition-transform motion-reduce:transition-none"
          classList={{ "rotate-90 rtl:-rotate-90": props.open }}
        />
      </button>
      {/* Shown and hidden at once: the card sits in a virtualized timeline row. */}
      <Show when={ticker() || lanes().length > 0}>
        <div class="flex flex-col gap-2 px-3 pb-2.5 text-[13px] leading-5">
          {/* One line, fixed height: a new step replaces the old one instead of pushing rows below it. */}
          <Show when={ticker()} keyed>
            {(part) => (
              <div data-slot="turn-steps-ticker" aria-live="polite" class="h-5 overflow-hidden">
                <div
                  data-slot="turn-steps-ticker-step"
                  data-running={isRunning(part) ? "" : undefined}
                  class="flex min-w-0 items-center gap-2 text-v2-text-text-base"
                >
                  <StepIcon name={stepIcon(stepOf(part).kind)} size="small" class="shrink-0 text-v2-text-text-muted" />
                  <span class="shrink-0 [font-weight:500]">{label(part)}</span>
                  <Show when={stepOf(part).target}>
                    {(target) => (
                      <span class="min-w-0 truncate font-mono text-[12px] text-v2-text-text-muted">{target()}</span>
                    )}
                  </Show>
                  <span class="flex-1" />
                  <Show when={isRunning(part) && elapsed(startOf(part))}>
                    {(time) => <span class="shrink-0 tabular-nums text-v2-text-text-muted">{time()}</span>}
                  </Show>
                </div>
              </div>
            )}
          </Show>
          <For each={lanes()}>
            {(lane) => {
              const content = () => (
                <>
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="shrink-0 [font-weight:500]">{label(lane.part)}</span>
                    <Show when={stepOf(lane.part).target}>
                      {(target) => <span class="min-w-0 truncate text-v2-text-text-muted">{target()}</span>}
                    </Show>
                    <span class="flex-1" />
                    <Show when={lane.steps.length > 0}>
                      <span class="shrink-0 tabular-nums text-[12px] text-v2-text-text-muted">
                        {language.plural("secondBrain.turnSteps.laneSteps", lane.steps.length, {
                          count: lane.steps.length.toLocaleString(language.intl()),
                        })}
                      </span>
                    </Show>
                  </div>
                  <div data-slot="turn-steps-lane-bar">
                    <div data-slot="turn-steps-lane-fill" />
                  </div>
                  <Show when={lane.current} keyed>
                    {(step) => {
                      const current = toolStep(step.tool, { title: step.title })
                      return (
                        <div
                          data-slot="turn-steps-ticker-step"
                          class="flex min-w-0 items-center gap-2 text-[12px] text-v2-text-text-muted"
                        >
                          <StepIcon name={stepIcon(current.kind)} size="small" class="shrink-0" />
                          <span class="shrink-0">
                            {language.t(
                              stepVerbKey(current.kind, step.status === "pending" || step.status === "in_progress"),
                            )}
                          </span>
                          <Show when={current.target}>
                            {(target) => <span class="min-w-0 truncate font-mono">{target()}</span>}
                          </Show>
                        </div>
                      )
                    }}
                  </Show>
                </>
              )
              return (
                <Show
                  when={openable(lane.part)}
                  fallback={
                    <div
                      data-slot="turn-steps-lane"
                      data-running={lane.running ? "" : undefined}
                      class="flex flex-col gap-1"
                    >
                      {content()}
                    </div>
                  }
                >
                  {(open) => (
                    <button
                      type="button"
                      data-slot="turn-steps-lane"
                      data-running={lane.running ? "" : undefined}
                      aria-label={language.t("secondBrain.agentTab.open", { agent: label(lane.part) })}
                      class="-mx-1.5 flex w-[calc(100%+12px)] cursor-pointer flex-col gap-1 rounded-[8px] px-1.5 py-0.5 text-left transition-colors hover:bg-v2-background-bg-layer-02 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-v2-border-border-focus"
                      onClick={() => open()(lane.part)}
                    >
                      {content()}
                    </button>
                  )}
                </Show>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
