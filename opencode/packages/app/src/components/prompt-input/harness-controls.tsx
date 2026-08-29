import { For, Show, createMemo } from "solid-js"
import { Harness } from "@opencode-ai/schema/harness"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"

export type PromptInputHarnessController = {
  instances: () => ReadonlyArray<Harness.Instance> | undefined
  loading: () => boolean
  disabled?: () => boolean
  refresh: () => unknown
  current: () => Harness.InstanceID
  select: (instanceID: Harness.InstanceID) => void
  model: {
    current: () => Harness.ModelSelection | undefined
    set: (model: Harness.ModelSelection | undefined) => void
  }
}

const SELECT_CLASS =
  "h-7 min-w-0 max-w-[220px] cursor-pointer rounded-[6px] border-0 bg-transparent px-2 text-[12px] text-v2-text-text-muted outline-none hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover disabled:cursor-wait disabled:opacity-60"

export function PromptInputHarnessControls(props: { controller: PromptInputHarnessController }) {
  const language = useLanguage()
  const instance = createMemo(() =>
    props.controller.instances()?.find((item) => item.id === props.controller.current()),
  )
  const model = createMemo(() => {
    const selection = props.controller.model.current()
    return instance()?.models.find((item) => item.id === selection?.id)
  })
  const selectModel = (id: string) => {
    const selected = instance()?.models.find((item) => item.id === id)
    if (!selected) return
    props.controller.model.set({
      id: selected.id,
      reasoningEffort: selected.defaultReasoningEffort,
      serviceTier: selected.defaultServiceTier,
    })
  }

  return (
    <>
      <select
        data-control="harness"
        aria-label={language.t("harness.label")}
        class={SELECT_CLASS}
        value={props.controller.current()}
        disabled={props.controller.loading() || props.controller.disabled?.() || !props.controller.instances()}
        onChange={(event) => props.controller.select(Harness.InstanceID.make(event.currentTarget.value))}
      >
        <Show when={props.controller.instances()} fallback={<option>{language.t("harness.checking")}</option>}>
          <For each={props.controller.instances()}>
            {(item) => (
              <option
                value={item.id}
                selected={item.id === props.controller.current()}
                disabled={item.status === "unavailable"}
                title={item.error}
              >
                {item.name}
                {item.status === "unavailable" ? ` - ${language.t("harness.unavailable")}` : ""}
              </option>
            )}
          </For>
        </Show>
      </select>
      <Show when={instance()?.driver !== Harness.OpenCodeDriver && instance()} keyed>
        {(item) => (
          <Show
            when={item.models.length > 0}
            fallback={<span class="px-2 text-[12px] text-v2-text-text-faint">{language.t("harness.models.none")}</span>}
          >
            <select
              data-control="harness-model"
              aria-label={language.t("harness.model")}
              class={SELECT_CLASS}
              value={props.controller.model.current()?.id}
              disabled={props.controller.disabled?.()}
              onChange={(event) => selectModel(event.currentTarget.value)}
            >
              <For each={item.models}>{(option) => <option value={option.id}>{option.name}</option>}</For>
            </select>
          </Show>
        )}
      </Show>
      <Show when={model()} keyed>
        {(selected) => (
          <>
            <Show when={selected.reasoningEfforts.length > 0}>
              <select
                data-control="harness-effort"
                aria-label={language.t("harness.effort")}
                class={SELECT_CLASS}
                value={props.controller.model.current()?.reasoningEffort ?? ""}
                disabled={props.controller.disabled?.()}
                onChange={(event) => {
                  const current = props.controller.model.current()
                  if (!current) return
                  props.controller.model.set({ ...current, reasoningEffort: event.currentTarget.value || undefined })
                }}
              >
                <option value="">{`${language.t("harness.effort")}: ${language.t("harness.default")}`}</option>
                <For each={selected.reasoningEfforts}>
                  {(effort) => <option value={effort}>{`${language.t("harness.effort")}: ${effort}`}</option>}
                </For>
              </select>
            </Show>
            <Show when={selected.serviceTiers.length > 0}>
              <select
                data-control="harness-service-tier"
                aria-label={language.t("harness.serviceTier")}
                class={SELECT_CLASS}
                value={props.controller.model.current()?.serviceTier ?? ""}
                disabled={props.controller.disabled?.()}
                onChange={(event) => {
                  const current = props.controller.model.current()
                  if (!current) return
                  props.controller.model.set({ ...current, serviceTier: event.currentTarget.value || undefined })
                }}
              >
                <option value="">{`${language.t("harness.serviceTier")}: ${language.t("harness.default")}`}</option>
                <For each={selected.serviceTiers}>
                  {(tier) => <option value={tier.id}>{`${language.t("harness.serviceTier")}: ${tier.name}`}</option>}
                </For>
              </select>
            </Show>
          </>
        )}
      </Show>
      <TooltipV2
        placement="top"
        value={`${language.t("harness.refreshModels")}${instance()?.version ? ` (${instance()!.version})` : ""}`}
      >
        <IconButtonV2
          data-action="harness-refresh"
          variant="ghost-muted"
          size="normal"
          icon={<Icon name="reset" />}
          aria-label={language.t("harness.refreshModels")}
          disabled={props.controller.loading() || props.controller.disabled?.()}
          onClick={() => void props.controller.refresh()}
        />
      </TooltipV2>
    </>
  )
}
