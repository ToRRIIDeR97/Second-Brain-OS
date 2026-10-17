import type { Harness } from "@opencode-ai/schema/harness"
import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { harnessSettingsChanged } from "@/components/prompt-input/harness-controller"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { Persist, persisted } from "@/utils/persist"
import { listHarnessUpdates, upgradeHarness } from "@/utils/server"
import { dismissToast, showToast } from "@/utils/toast"

/** Checks harness CLIs once per server connection and offers each available update in a toast. */
export function HarnessUpdateNotifier() {
  const language = useLanguage()
  const layout = useLayout()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  // "Later" hides an update until a newer version than the one dismissed comes out.
  const [prefs, setPrefs, , ready] = persisted(
    Persist.global("harness-updates"),
    createStore<{ dismissed: Record<string, string> }>({ dismissed: {} }),
  )
  const server = () => ({ server: serverSDK().server.http, fetch: platform.fetch })
  // Harness routes are global; they only need some valid location.
  const directory = createMemo(
    () => layout.home.selection().directory || layout.projects.list()[0]?.worktree || serverSync().data.path.home,
  )

  const offer = (update: Harness.UpdateStatus) => {
    const id = showToast({
      title: language.t("harness.update.toast.title", { name: update.name, latest: update.latest ?? "" }),
      description: update.method
        ? language.t("harness.update.toast.description", { version: update.version ?? "" })
        : language.t("harness.settings.updateManual"),
      persistent: true,
      actions: [
        ...(update.method
          ? [{ label: language.t("harness.settings.update"), onClick: () => void install(update, id) }]
          : []),
        {
          label: language.t("harness.update.toast.later"),
          onClick: () => {
            setPrefs("dismissed", update.id, update.latest ?? "")
            dismissToast(id)
          },
        },
      ],
    })
  }

  const install = (update: Harness.UpdateStatus, toast: number) => {
    const dir = directory()
    if (!dir) return
    dismissToast(toast)
    showToast({ title: language.t("harness.settings.updating"), description: update.name })
    return upgradeHarness(server(), dir, update.id).then(
      (result) => {
        harnessSettingsChanged()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("harness.settings.updated", { name: result.name, version: result.version ?? "" }),
        })
      },
      (error: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
    )
  }

  let checked = false
  createEffect(() => {
    const dir = directory()
    if (checked || !dir || !ready()) return
    checked = true
    void listHarnessUpdates(server(), dir)
      .then((updates) =>
        updates
          .filter((update) => update.updateAvailable && prefs.dismissed[update.id] !== update.latest)
          .forEach(offer),
      )
      .catch(() => undefined)
  })

  return null
}
