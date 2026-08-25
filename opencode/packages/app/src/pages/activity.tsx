import { useNavigate } from "@solidjs/router"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeScrollController } from "@/pages/home/home-scroll-controller"
import { createHomeSessionSearchController } from "@/pages/home/home-session-search-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { HomeSessions } from "@/pages/home/home-sessions"

export default function ActivityPage() {
  const language = useLanguage()
  const navigate = useNavigate()
  const platform = usePlatform()
  const home = createHomeController()
  const sessions = createHomeSessionsController(home)
  const search = createHomeSessionSearchController(home, sessions)
  const scroll = createHomeScrollController(sessions.data.groups)
  const [view, setView] = createSignal<ActivityView>("attention")
  const [google] = createResource(
    () => platform.googleCalendar,
    (planner) => planner.status(),
  )
  const attention = createMemo(() => {
    const data = home.server.focusedSync().session.data
    return sessions.data.records().filter((record) => {
      const status = data.session_status[record.session.id]
      return (status?.type ?? "idle") !== "idle" || (data.permission[record.session.id]?.length ?? 0) > 0
    })
  })
  const changes = createMemo(() => sessions.data.records().filter((record) => (record.session.summary?.files ?? 0) > 0))

  return (
    <section class="flex h-full min-h-0 w-full flex-col gap-2 p-2" aria-labelledby="activity-title">
      <header class="flex min-h-12 shrink-0 items-center gap-3 rounded-[10px] bg-v2-background-bg-base px-4 shadow-[var(--v2-elevation-raised)]">
        <div class="min-w-0 flex-1">
          <h1 id="activity-title" class="text-[15px] text-v2-text-text-strong [font-weight:530]">
            {language.t("secondBrain.activity.title")}
          </h1>
          <p class="truncate text-[12px] text-v2-text-text-faint">{language.t("secondBrain.activity.description")}</p>
        </div>
      </header>

      <nav
        class="flex min-h-10 shrink-0 items-center gap-1 rounded-[10px] bg-v2-background-bg-base px-2 shadow-[var(--v2-elevation-raised)]"
        aria-label={language.t("secondBrain.activity.views")}
      >
        <For each={activityViews}>
          {(item) => (
            <button
              type="button"
              aria-current={view() === item ? "page" : undefined}
              data-selected={view() === item ? "" : undefined}
              class="h-8 rounded-[6px] px-3 text-[12px] text-v2-text-text-muted transition-colors duration-120 hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
              onClick={() => setView(item)}
            >
              {language.t(`secondBrain.activity.view.${item}`)}
            </button>
          )}
        </For>
      </nav>

      <div class="min-h-0 flex-1 overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
        <Show when={view() === "attention"}>
          <div class="h-full overflow-y-auto p-4 sm:p-6">
            <div class="mx-auto flex max-w-[840px] flex-col gap-3">
              <Show when={(google()?.failedWrites ?? 0) > 0}>
                <AttentionCard
                  tone="critical"
                  title={language.t("secondBrain.activity.googleFailed", { count: google()?.failedWrites ?? 0 })}
                  detail={language.t("secondBrain.activity.googleFailedDetail")}
                  action={language.t("secondBrain.activity.openCalendar")}
                  onAction={() => navigate("/calendar?google=connect")}
                />
              </Show>
              <Show when={(google()?.pendingWrites ?? 0) > 0}>
                <AttentionCard
                  title={language.t("secondBrain.activity.googlePending", { count: google()?.pendingWrites ?? 0 })}
                  detail={language.t("secondBrain.activity.googlePendingDetail")}
                  action={language.t("secondBrain.activity.openCalendar")}
                  onAction={() => navigate("/calendar")}
                />
              </Show>
              <For each={attention()}>
                {(record) => {
                  const data = () => home.server.focusedSync().session.data
                  const approvals = () => data().permission[record.session.id]?.length ?? 0
                  return (
                    <button
                      type="button"
                      class="flex min-h-14 w-full items-center gap-3 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-4 text-left transition-colors duration-120 hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                      onClick={() => sessions.session.open(record.session)}
                    >
                      <span class="size-2 shrink-0 rounded-full bg-v2-icon-icon-accent" />
                      <span class="min-w-0 flex-1">
                        <strong class="block truncate text-[13px] text-v2-text-text-base [font-weight:530]">
                          {record.session.title}
                        </strong>
                        <span class="block truncate text-[11px] text-v2-text-text-faint">
                          {approvals() > 0
                            ? language.t("secondBrain.activity.approvals", { count: approvals() })
                            : language.t("secondBrain.activity.running")}
                        </span>
                      </span>
                    </button>
                  )
                }}
              </For>
              <Show
                when={
                  !google.loading && attention().length === 0 && !(google()?.pendingWrites || google()?.failedWrites)
                }
              >
                <p class="py-12 text-center text-[13px] text-v2-text-text-faint">
                  {language.t("secondBrain.activity.attentionEmpty")}
                </p>
              </Show>
            </div>
          </div>
        </Show>
        <Show when={view() === "changes"}>
          <div class="h-full overflow-y-auto p-4 sm:p-6">
            <div class="mx-auto flex max-w-[840px] flex-col gap-2">
              <Show
                when={changes().length > 0}
                fallback={
                  <p class="py-12 text-center text-[13px] text-v2-text-text-faint">
                    {language.t("secondBrain.activity.changesEmpty")}
                  </p>
                }
              >
                <For each={changes()}>
                  {(record) => (
                    <button
                      type="button"
                      class="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 px-4 text-left transition-colors duration-120 hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
                      onClick={() => sessions.session.open(record.session)}
                    >
                      <span class="min-w-0">
                        <strong class="block truncate text-[13px] text-v2-text-text-base [font-weight:530]">
                          {record.session.title}
                        </strong>
                        <span class="block truncate text-[11px] text-v2-text-text-faint">{record.projectName}</span>
                      </span>
                      <span class="text-right text-[11px] tabular-nums text-v2-text-text-muted">
                        {language.t("secondBrain.activity.changeSummary", {
                          files: record.session.summary?.files ?? 0,
                          additions: record.session.summary?.additions ?? 0,
                          deletions: record.session.summary?.deletions ?? 0,
                        })}
                      </span>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Show>
        <Show when={view() === "runs" || view() === "history"}>
          <ScrollView
            class="h-full [container-type:size]"
            thumbContainer={scroll.viewport.thumbTrack}
            thumbHoverTarget={scroll.viewport.hoverTarget}
            viewportRef={scroll.viewport.setViewport}
            onScroll={(event) => scroll.viewport.update(event.currentTarget.scrollTop)}
            onWheel={scroll.viewport.containOuterWheel}
          >
            <div class="mx-auto flex min-h-full w-full max-w-[840px] px-4 sm:px-6">
              <HomeSessions sessions={sessions} search={search} scroll={scroll} />
            </div>
          </ScrollView>
        </Show>
      </div>
    </section>
  )
}

type ActivityView = (typeof activityViews)[number]
const activityViews = ["attention", "runs", "changes", "history"] as const

function AttentionCard(props: {
  title: string
  detail: string
  tone?: "critical"
  action: string
  onAction: () => void
}) {
  return (
    <div
      role={props.tone === "critical" ? "alert" : "status"}
      class="rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4"
    >
      <strong
        classList={{
          "block text-[13px] [font-weight:530]": true,
          "text-v2-text-text-critical": props.tone === "critical",
          "text-v2-text-text-base": props.tone !== "critical",
        }}
      >
        {props.title}
      </strong>
      <p class="mt-1 text-[12px] leading-5 text-v2-text-text-muted">{props.detail}</p>
      <ButtonV2 class="mt-3" size="small" variant="outline" onClick={props.onAction}>
        {props.action}
      </ButtonV2>
    </div>
  )
}
