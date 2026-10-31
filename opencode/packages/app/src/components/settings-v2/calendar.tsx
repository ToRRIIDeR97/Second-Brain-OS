import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { For, Show, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { calendarSync, syncGoogleCalendar } from "@/features/second-brain/calendar-sync"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

const INTERVALS = [5, 15, 30, 60]

export function SettingsCalendarV2() {
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  const layout = useLayout()
  const serverSDK = useServerSDK()
  const [status, { refetch }] = createResource(() => platform.googleCalendar?.status())
  const [error, setError] = createSignal("")
  // Re-renders "Synced N min ago" every half minute.
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 30_000)
  onCleanup(() => clearInterval(tick))

  const config = () => settings.calendar.sync()
  const lastSynced = createMemo(() => {
    const times = (status.latest?.accounts ?? []).flatMap((account) =>
      account.lastSyncedAt ? [Date.parse(account.lastSyncedAt)] : [],
    )
    const latest = Math.max(calendarSync.lastSynced() ?? 0, ...times)
    return latest > 0 ? latest : undefined
  })
  const ago = () => {
    const last = lastSynced()
    if (!last) return language.t("secondBrain.settings.calendar.neverSynced")
    const minutes = Math.round((now() - last) / 60_000)
    if (minutes < 1) return language.t("secondBrain.settings.calendar.syncedJustNow")
    return language.t("secondBrain.settings.calendar.syncedAgo", { minutes })
  }
  const intervalOptions = INTERVALS.map((minutes) => ({
    value: minutes,
    label: language.t("secondBrain.settings.calendar.every", { minutes }),
  }))
  const syncNow = async () => {
    const google = platform.googleCalendar
    const directory = layout.home.workspace()
    if (!google || !directory) return
    setError("")
    await syncGoogleCalendar({
      google,
      client: { server: serverSDK().server, fetch: platform.fetch, target: { directory } },
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    void refetch()
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.settings.calendar.title")}</h2>
      </div>
      <div class="settings-v2-tab-body" data-component="calendar-settings">
        <Show
          when={platform.googleCalendar}
          fallback={<div class="settings-v2-provider-empty">{language.t("secondBrain.settings.calendar.desktopOnly")}</div>}
        >
          <div class="settings-v2-section">
            <h4 class="settings-v2-section-title">{language.t("secondBrain.settings.calendar.accounts")}</h4>
            <SettingsListV2>
              <For
                each={status.latest?.accounts ?? []}
                fallback={
                  <SettingsRowV2
                    title={language.t("secondBrain.settings.calendar.noAccounts")}
                    description={language.t("secondBrain.settings.calendar.noAccounts.description")}
                  >
                    <span />
                  </SettingsRowV2>
                }
              >
                {(account) => (
                  <SettingsRowV2
                    title={account.email ?? account.label}
                    description={
                      account.errorCode === "google_reconnect_required"
                        ? language.t("secondBrain.settings.calendar.reconnect")
                        : account.access === "write"
                          ? language.t("secondBrain.settings.calendar.access.write")
                          : language.t("secondBrain.settings.calendar.access.read")
                    }
                  >
                    <span />
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </div>

          <div class="settings-v2-section">
            <div class="flex items-center gap-2">
              <h4 class="settings-v2-section-title flex-1">{language.t("secondBrain.settings.calendar.sync")}</h4>
              <span class="text-12-regular text-text-weak" data-slot="calendar-last-synced">
                {calendarSync.busy() ? language.t("secondBrain.settings.calendar.syncing") : ago()}
              </span>
              <ButtonV2
                size="small"
                variant="tonal"
                data-action="calendar-sync-now"
                disabled={calendarSync.busy() || !status.latest?.connected}
                onClick={() => void syncNow()}
              >
                {language.t("secondBrain.settings.calendar.syncNow")}
              </ButtonV2>
            </div>
            <Show when={error()}>
              <div class="settings-v2-provider-empty" role="alert">
                {error()}
              </div>
            </Show>
            <SettingsListV2>
              <SettingsRowV2
                title={language.t("secondBrain.settings.calendar.auto")}
                description={language.t("secondBrain.settings.calendar.auto.description")}
              >
                <Switch
                  checked={config().autoSync}
                  hideLabel
                  onChange={(value: boolean) => settings.calendar.setSync({ autoSync: value })}
                >
                  {language.t("secondBrain.settings.calendar.auto")}
                </Switch>
              </SettingsRowV2>
              <SettingsRowV2
                title={language.t("secondBrain.settings.calendar.interval")}
                description={language.t("secondBrain.settings.calendar.interval.description")}
              >
                <SelectV2
                  appearance="inline"
                  data-action="calendar-sync-interval"
                  options={intervalOptions}
                  current={
                    intervalOptions.find((option) => option.value === config().intervalMinutes) ?? intervalOptions[1]
                  }
                  placement="bottom-end"
                  gutter={6}
                  disabled={!config().autoSync}
                  value={(option) => String(option.value)}
                  label={(option) => option.label}
                  onSelect={(option) => option && settings.calendar.setSync({ intervalMinutes: option.value })}
                />
              </SettingsRowV2>
              <SettingsRowV2 title={language.t("secondBrain.settings.calendar.onOpen")}>
                <Switch
                  checked={config().onOpen}
                  disabled={!config().autoSync}
                  hideLabel
                  onChange={(value: boolean) => settings.calendar.setSync({ onOpen: value })}
                >
                  {language.t("secondBrain.settings.calendar.onOpen")}
                </Switch>
              </SettingsRowV2>
              <SettingsRowV2
                title={language.t("secondBrain.settings.calendar.onFocus")}
                description={language.t("secondBrain.settings.calendar.onFocus.description")}
              >
                <Switch
                  checked={config().onFocus}
                  disabled={!config().autoSync}
                  hideLabel
                  onChange={(value: boolean) => settings.calendar.setSync({ onFocus: value })}
                >
                  {language.t("secondBrain.settings.calendar.onFocus")}
                </Switch>
              </SettingsRowV2>
            </SettingsListV2>
          </div>
        </Show>
      </div>
    </>
  )
}
