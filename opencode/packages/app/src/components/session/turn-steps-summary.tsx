import { For, Show, createMemo } from "solid-js"
import type { Part } from "@opencode-ai/sdk/v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { summarizeTurn, type StepKind, type TurnSteps } from "@opencode-ai/session-ui/step-kind"
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
  durationMs?: number
  open: boolean
  onToggle: (open: boolean) => void
}) {
  const language = useLanguage()
  const summary = createMemo(() => summarizeTurn(props.parts))
  const phrases = createMemo(() => stepCountPhrases(language, summary().counts))
  const title = () => {
    if (props.working) return language.t("secondBrain.turnSteps.working")
    const duration = formatTurnDuration(language, props.durationMs)
    if (!duration) return language.t("secondBrain.turnSteps.workedNoDuration")
    return language.t("secondBrain.turnSteps.worked", { duration })
  }

  return (
    <button
      type="button"
      data-component="turn-steps-summary"
      data-state={props.open ? "open" : "closed"}
      data-working={props.working ? "" : undefined}
      aria-expanded={props.open}
      class="flex h-9 w-full min-w-0 items-center gap-2 rounded-[16px] bg-v2-background-bg-layer-01 px-3 text-left text-[14px] leading-5 text-v2-text-text-base"
      onClick={() => props.onToggle(!props.open)}
    >
      <span data-slot="turn-steps-title" class="shrink-0 [font-weight:500]">
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
      <Icon
        name={props.open ? "chevron-down" : "chevron-right"}
        size="small"
        class="shrink-0 text-v2-text-text-muted"
      />
    </button>
  )
}
