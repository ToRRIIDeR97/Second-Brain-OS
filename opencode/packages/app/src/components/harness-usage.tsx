import { For, Match, Show, Switch } from "solid-js"
import type { Harness } from "@opencode-ai/schema/harness"
import { useLanguage } from "@/context/language"
import { formatResetIn } from "@/components/prompt-input/context-strip-model"

/**
 * One harness's usage report: a bar per limit window with its share used and reset time, or the reason there
 * are no bars. The context sheet and Settings → Harnesses both show it. `revealed` grows the bars in; the sheet
 * passes its open state so they ease in as it unfolds.
 */
export function HarnessUsageWindows(props: { report: Harness.UsageReport; now: number; revealed?: boolean }) {
  const language = useLanguage()
  const percent = (value: number) =>
    new Intl.NumberFormat(language.intl(), { style: "percent", maximumFractionDigits: 0 }).format(value / 100)

  return (
    <Switch
      fallback={<span title={props.report.reason}>{language.t("secondBrain.contextStrip.usage.unsupported")}</span>}
    >
      <Match when={props.report.status === "available" && props.report.windows.length > 0}>
        <For each={props.report.windows}>
          {(window) => (
            <div
              data-slot="context-sheet-usage-window"
              class="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-x-2.5"
            >
              <span class="truncate">{window.label}</span>
              <span
                data-slot="context-sheet-bar-track"
                class="h-2 overflow-hidden rounded-full bg-v2-background-bg-layer-04"
                role="meter"
                aria-label={window.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={window.usedPercent}
              >
                <span
                  data-slot="context-sheet-bar"
                  class="block h-full rounded-full bg-v2-icon-icon-accent"
                  style={{
                    width: `max(3px, ${window.usedPercent}%)`,
                    transform: props.revealed === false ? "scaleX(0)" : "scaleX(1)",
                  }}
                />
              </span>
              <span class="flex justify-end gap-2 tabular-nums">
                <span class="text-v2-text-text-base">
                  {language.t("secondBrain.contextStrip.usage.used", { percent: percent(window.usedPercent) })}
                </span>
                <Show when={window.resetsAt}>
                  {(resetsAt) => (
                    <span>
                      {language.t("secondBrain.contextStrip.usage.resets", {
                        time: formatResetIn(resetsAt(), props.now, language.intl()),
                      })}
                    </span>
                  )}
                </Show>
              </span>
            </div>
          )}
        </For>
      </Match>
      <Match when={props.report.status === "available"}>
        <span>{language.t("secondBrain.contextStrip.usage.noLimits")}</span>
      </Match>
      <Match when={props.report.status === "signed-out"}>
        {/* The server's reason says what to do, e.g. replace an expired API key; signing in doesn't fix that. */}
        <span>{props.report.reason ?? language.t("secondBrain.contextStrip.usage.signedOut")}</span>
      </Match>
      <Match when={props.report.status === "error"}>
        <span title={props.report.reason}>{language.t("secondBrain.contextStrip.usage.error")}</span>
      </Match>
    </Switch>
  )
}

/** The fullest limit window of a report, for a one-number summary; undefined when it reports no windows. */
export function fullestWindow(report: Harness.UsageReport | undefined) {
  if (report?.status !== "available") return undefined
  return report.windows.reduce<Harness.UsageWindow | undefined>(
    (fullest, window) => (!fullest || window.usedPercent > fullest.usedPercent ? window : fullest),
    undefined,
  )
}
