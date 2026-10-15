import { createEffect, createMemo, createResource, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Harness } from "@opencode-ai/schema/harness"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { Persist, persisted } from "@/utils/persist"
import { fallbackHarnesses, listHarnessesForServer } from "@/utils/server"
import type { PromptInputHarnessController } from "./harness-controls"

type HarnessSelection = {
  current: () => Harness.InstanceID
  set: (instanceID: Harness.InstanceID, model?: Harness.ModelSelection) => void
  model: PromptInputHarnessController["model"]
  disabled?: () => boolean
  fallbackUnavailable?: boolean
}

// The last model the user picked for a harness wins over the agent's own default, which may be one
// the agent can't serve to this client (upstream OpenCode defaults to a free tier that rejects it).
const defaultModel = (instance: Harness.Instance, remembered?: string) => {
  if (instance.driver === Harness.OpenCodeDriver) return
  const model =
    instance.models.find((item) => item.id === remembered) ??
    instance.models.find((item) => item.isDefault) ??
    instance.models[0]
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
  const [instances, { refetch }] = createResource(
    () => ({ directory: sdk().directory, version: settingsVersion() }),
    ({ directory }) =>
      listHarnessesForServer({ server: serverSDK().server.http, fetch: platform.fetch }, directory).catch(
        fallbackHarnesses,
      ),
  )
  const instance = createMemo(() => instances()?.find((item) => item.id === selection.current()))
  const [picked, setPicked, , pickedReady] = persisted(
    Persist.global("harness.model"),
    createStore({ models: {} as Record<string, string> }),
  )
  const preferred = (instance: Harness.Instance) => defaultModel(instance, picked.models[instance.id])

  createEffect(() => {
    const available = instances()
    if (!available || !pickedReady()) return
    const current = available.find((item) => item.id === selection.current())
    const selected =
      current?.status === "available"
        ? current
        : selection.fallbackUnavailable === false
          ? undefined
          : available.find((item) => item.status === "available")
    if (!selected) return
    if (selected.id !== selection.current()) {
      selection.set(selected.id, preferred(selected))
      return
    }
    if (selected.driver === Harness.OpenCodeDriver) {
      if (selection.model.current()) selection.model.set(undefined)
      return
    }
    const currentModel = selection.model.current()
    if (selected.models.some((model) => model.id === currentModel?.id)) return
    selection.model.set(preferred(selected))
  })

  return {
    instances,
    instance,
    driver: () => instance()?.driver,
    loading: () => instances.loading,
    disabled: selection.disabled,
    refresh: refetch,
    current: selection.current,
    select(instanceID: Harness.InstanceID) {
      const next = instances()?.find((item) => item.id === instanceID)
      selection.set(instanceID, next ? preferred(next) : undefined)
      void refetch()
    },
    model: {
      current: selection.model.current,
      // Only explicit picks land here; automatic defaults go through `selection.model` directly.
      set: (model: Harness.ModelSelection | undefined) => {
        if (model) setPicked("models", selection.current(), model.id)
        selection.model.set(model)
      },
    },
  } satisfies PromptInputHarnessController & {
    instance: () => Harness.Instance | undefined
    driver: () => Harness.DriverKind | undefined
  }
}
