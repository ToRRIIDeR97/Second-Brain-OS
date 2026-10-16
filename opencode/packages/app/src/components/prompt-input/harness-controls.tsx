import { Show, createMemo } from "solid-js"
import { Harness } from "@opencode-ai/schema/harness"
import { PromptInputV2Select } from "@opencode-ai/session-ui/v2/prompt-input"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { List } from "@opencode-ai/ui/list"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { listV2Class } from "@/components/surface-classes"

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

// Tenon Workbench's own loop first, then every external agent (built-in or registered) as one group.
export function orderHarnesses(instances: ReadonlyArray<Harness.Instance> | undefined) {
  return instances?.toSorted((a, b) => Number(isExternalHarness(a)) - Number(isExternalHarness(b)))
}

export function isExternalHarness(instance: Pick<Harness.Instance, "driver">) {
  return instance.driver !== Harness.OpenCodeDriver
}

export async function openHarnessSettings(dialog: ReturnType<typeof useDialog>) {
  // Loaded on demand: Settings renders these controls too, so a static import would be circular.
  const { DialogSettings } = await import("@/components/settings-v2/dialog-settings-v2")
  void dialog.show(() => <DialogSettings defaultValue="harnesses" />)
}

// Agents like upstream OpenCode report around a thousand models; past this a menu needs search.
const SEARCH_THRESHOLD = 20

function DialogSelectHarnessModel(props: {
  models: ReadonlyArray<Harness.Model>
  current?: string
  onSelect: (id: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{language.t("dialog.model.select.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="min-h-0">
        <List
          class={`flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${listV2Class}`}
          search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
          emptyMessage={language.t("dialog.model.empty")}
          key={(model) => model.id}
          items={[...props.models]}
          current={props.models.find((model) => model.id === props.current)}
          filterKeys={["name", "id"]}
          groupBy={(model) => (model.id.includes("/") ? model.id.slice(0, model.id.indexOf("/")) : "")}
          onSelect={(model) => {
            if (model) props.onSelect(model.id)
            dialog.close()
          }}
        >
          {(model) => <span class="truncate text-[13px]">{model.name}</span>}
        </List>
      </DialogBody>
    </Dialog>
  )
}

const SELECT_CLASS =
  "prompt-input-responsive-select !h-7 !w-auto min-w-0 max-w-[220px] !bg-transparent !shadow-none hover:!bg-v2-overlay-simple-overlay-hover"

export function PromptInputHarnessControls(props: { controller: PromptInputHarnessController }) {
  const language = useLanguage()
  const dialog = useDialog()
  const options = createMemo(() => orderHarnesses(props.controller.instances()))
  const addHarness = () => openHarnessSettings(dialog)
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
      <PromptInputV2Select
        title={language.t("harness.label")}
        options={
          options()?.map((item) => ({
            id: item.id,
            label: item.name + (item.status === "unavailable" ? ` - ${language.t("harness.unavailable")}` : ""),
            disabled: item.status === "unavailable",
            title: item.error,
            group: isExternalHarness(item) ? language.t("harness.group.external") : undefined,
          })) ?? [{ id: props.controller.current(), label: language.t("harness.checking") }]
        }
        footer={{ label: language.t("harness.settings.add"), onSelect: () => void addHarness() }}
        current={props.controller.current()}
        control="harness"
        currentIcon={<Icon name="status" />}
        class={SELECT_CLASS}
        disabled={props.controller.loading() || props.controller.disabled?.() || !props.controller.instances()}
        onSelect={(id) => props.controller.select(Harness.InstanceID.make(id))}
      />
      <Show when={instance()?.driver !== Harness.OpenCodeDriver && instance()} keyed>
        {(item) => (
          <Show
            when={item.models.length > 0}
            fallback={<span class="px-2 text-[12px] text-v2-text-text-faint">{language.t("harness.models.none")}</span>}
          >
            <Show
              when={item.models.length > SEARCH_THRESHOLD}
              fallback={
                <PromptInputV2Select
                  title={language.t("harness.model")}
                  options={item.models.map((option) => ({ id: option.id, label: option.name }))}
                  current={props.controller.model.current()?.id ?? item.models[0]?.id ?? ""}
                  control="harness-model"
                  currentIcon={<Icon name="monitor" />}
                  class={SELECT_CLASS}
                  capitalize={false}
                  disabled={props.controller.disabled?.()}
                  onSelect={selectModel}
                />
              }
            >
              <TooltipV2 placement="top" value={`${language.t("harness.model")}: ${model()?.name ?? ""}`}>
                <ButtonV2
                  variant="ghost-muted"
                  size="normal"
                  class={`justify-start ![font-weight:440] ${SELECT_CLASS}`}
                  data-control="harness-model"
                  aria-label={language.t("harness.model")}
                  disabled={props.controller.disabled?.()}
                  onClick={() =>
                    dialog.show(() => (
                      <DialogSelectHarnessModel
                        models={item.models}
                        current={props.controller.model.current()?.id}
                        onSelect={selectModel}
                      />
                    ))
                  }
                >
                  <span class="prompt-input-control-icon flex shrink-0">
                    <Icon name="monitor" />
                  </span>
                  <span class="prompt-input-control-label truncate leading-5">
                    {model()?.name ?? language.t("dialog.model.select.title")}
                  </span>
                  <span class="prompt-input-control-chevron -ms-0.5 -me-1 flex shrink-0">
                    <Icon name="chevron-down" />
                  </span>
                </ButtonV2>
              </TooltipV2>
            </Show>
          </Show>
        )}
      </Show>
      <Show when={model()} keyed>
        {(selected) => (
          <>
            <Show when={selected.reasoningEfforts.length > 0}>
              <PromptInputV2Select
                title={language.t("harness.effort")}
                options={[
                  { id: "", label: language.t("harness.default") },
                  ...selected.reasoningEfforts.map((effort) => ({ id: effort, label: effort })),
                ]}
                current={props.controller.model.current()?.reasoningEffort ?? ""}
                control="harness-effort"
                currentIcon={<Icon name="settings-gear" />}
                class={SELECT_CLASS}
                capitalize={false}
                disabled={props.controller.disabled?.()}
                onSelect={(reasoningEffort) => {
                  const current = props.controller.model.current()
                  if (!current) return
                  props.controller.model.set({ ...current, reasoningEffort: reasoningEffort || undefined })
                }}
              />
            </Show>
            <Show when={selected.serviceTiers.length > 0}>
              <PromptInputV2Select
                title={language.t("harness.serviceTier")}
                options={[
                  { id: "", label: language.t("harness.default") },
                  ...selected.serviceTiers.map((tier) => ({ id: tier.id, label: tier.name })),
                ]}
                current={props.controller.model.current()?.serviceTier ?? ""}
                control="harness-service-tier"
                currentIcon={<Icon name="outline-sliders" />}
                class={SELECT_CLASS}
                capitalize={false}
                disabled={props.controller.disabled?.()}
                onSelect={(serviceTier) => {
                  const current = props.controller.model.current()
                  if (!current) return
                  props.controller.model.set({ ...current, serviceTier: serviceTier || undefined })
                }}
              />
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
