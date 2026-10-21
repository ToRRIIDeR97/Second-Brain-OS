import { createEffect, createMemo, createResource, createSignal } from "solid-js"
import { Harness } from "@opencode-ai/schema/harness"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings, withVisibleModels } from "@/context/settings"
import { fallbackHarnesses, listHarnessesForServer, refreshHarnesses } from "@/utils/server"
import type { PromptInputHarnessController } from "./harness-controls"

type HarnessSelection = {
  current: () => Harness.InstanceID
  set: (instanceID: Harness.InstanceID, model?: Harness.ModelSelection) => void
  model: PromptInputHarnessController["model"]
  disabled?: () => boolean
  fallbackUnavailable?: boolean
}

/** The model a harness starts with: its marked default, else its first model. The built-in loop uses the app's own picker. */
export const defaultModel = (instance: Harness.Instance) => {
  if (instance.driver === Harness.OpenCodeDriver) return
  const model = instance.models.find((item) => item.isDefault) ?? instance.models[0]
  return model
    ? {
        id: model.id,
        reasoningEffort: model.defaultReasoningEffort,
        serviceTier: model.defaultServiceTier,
      }
    : undefined
}

// Bumped by Settings after a harness is added, toggled, or removed, so open prompts refetch the list.
const [settingsVersion, setSettingsVersion] = createSignal(0)
export const harnessSettingsChanged = () => setSettingsVersion((value) => value + 1)

export function createPromptHarnessController(selection: HarnessSelection) {
  const sdk = useSDK()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const server = () => ({ server: serverSDK().server.http, fetch: platform.fetch })
  const [loaded, { refetch, mutate }] = createResource(
    () => ({ directory: sdk().directory, version: settingsVersion() }),
    ({ directory }) => listHarnessesForServer(server(), directory).catch(fallbackHarnesses),
  )
  // Models hidden in Settings never reach the picker or the default-model choice.
  const instances = createMemo(() =>
    loaded()?.map((item) =>
      withVisibleModels(item, settings.harnesses.hiddenModels(item.id), settings.harnesses.hiddenProviders(item.id)),
    ),
  )
  const [refreshing, setRefreshing] = createSignal(false)
  // The refresh button asks the harness again instead of reading the server's recent check.
  const refresh = () => {
    if (refreshing()) return
    setRefreshing(true)
    return refreshHarnesses(server(), sdk().directory, selection.current())
      .then(
        (next) => mutate(next),
        () => refetch(),
      )
      .finally(() => setRefreshing(false))
  }
  const instance = createMemo(() => instances()?.find((item) => item.id === selection.current()))

  createEffect(() => {
    const available = instances()
    if (!available) return
    const current = available.find((item) => item.id === selection.current())
    const selected =
      current?.status === "available"
        ? current
        : selection.fallbackUnavailable === false
          ? undefined
          : available.find((item) => item.status === "available")
    if (!selected) return
    if (selected.id !== selection.current()) {
      selection.set(selected.id, defaultModel(selected))
      return
    }
    if (selected.driver === Harness.OpenCodeDriver) {
      if (selection.model.current()) selection.model.set(undefined)
      return
    }
    const currentModel = selection.model.current()
    if (selected.models.some((model) => model.id === currentModel?.id)) return
    selection.model.set(defaultModel(selected))
  })

  return {
    instances,
    instance,
    driver: () => instance()?.driver,
    loading: () => loaded.loading || refreshing(),
    disabled: selection.disabled,
    refresh,
    current: selection.current,
    select(instanceID: Harness.InstanceID) {
      const next = instances()?.find((item) => item.id === instanceID)
      selection.set(instanceID, next ? defaultModel(next) : undefined)
      void refetch()
    },
    model: selection.model,
  } satisfies PromptInputHarnessController & {
    instance: () => Harness.Instance | undefined
    driver: () => Harness.DriverKind | undefined
  }
}
