import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogHeader } from "@opencode-ai/ui/v2/dialog-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@/utils/toast"
import { batch, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { type FormState, headerRow, modelRow, validateCustomProvider } from "./dialog-custom-provider-form"
import { filledFieldClass } from "./surface-classes"

type Props = {
  onBack: () => void
}

export function DialogCustomProvider(props: Props) {
  const language = useLanguage()

  return (
    <Dialog size="large">
      <DialogHeader closeLabel={language.t("common.close")}>
        <IconButtonV2
          tabIndex={-1}
          variant="ghost-muted"
          size="small"
          class="-my-1"
          icon={<Icon name="chevron-down" class="rotate-90" />}
          onClick={props.onBack}
          aria-label={language.t("common.goBack")}
        />
      </DialogHeader>
      <DialogBody class="min-h-0 px-2 pb-2">
        <CustomProviderForm />
      </DialogBody>
    </Dialog>
  )
}

export function CustomProviderForm(props: { autofocus?: boolean } = {}) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const language = useLanguage()

  const [form, setForm] = createStore<FormState>({
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: [modelRow()],
    headers: [headerRow()],
    err: {},
  })

  const addModel = () => {
    setForm(
      "models",
      produce((rows) => {
        rows.push(modelRow())
      }),
    )
  }

  const removeModel = (index: number) => {
    if (form.models.length <= 1) return
    setForm(
      "models",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const addHeader = () => {
    setForm(
      "headers",
      produce((rows) => {
        rows.push(headerRow())
      }),
    )
  }

  const removeHeader = (index: number) => {
    if (form.headers.length <= 1) return
    setForm(
      "headers",
      produce((rows) => {
        rows.splice(index, 1)
      }),
    )
  }

  const setField = (key: "providerID" | "name" | "baseURL" | "apiKey", value: string) => {
    setForm(key, value)
    if (key === "apiKey") return
    setForm("err", key, undefined)
  }

  const setModel = (index: number, key: "id" | "name", value: string) => {
    batch(() => {
      setForm("models", index, key, value)
      setForm("models", index, "err", key, undefined)
    })
  }

  const setHeader = (index: number, key: "key" | "value", value: string) => {
    batch(() => {
      setForm("headers", index, key, value)
      setForm("headers", index, "err", key, undefined)
    })
  }

  const validate = () => {
    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: serverSync().data.config.disabled_providers ?? [],
      existingProviderIDs: new Set(serverSync().data.provider.all.keys()),
    })
    batch(() => {
      setForm("err", output.err)
      output.models.forEach((err, index) => setForm("models", index, "err", err))
      output.headers.forEach((err, index) => setForm("headers", index, "err", err))
    })
    return output.result
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async (result: NonNullable<ReturnType<typeof validate>>) => {
      if ((await serverSDK().protocol) !== "v1") throw new Error(language.t("provider.custom.unavailable"))
      const disabledProviders = serverSync().data.config.disabled_providers ?? []
      const nextDisabled = disabledProviders.filter((id) => id !== result.providerID)

      if (result.key) {
        await serverSDK().client.auth.set({
          providerID: result.providerID,
          auth: {
            type: "api",
            key: result.key,
          },
        })
      }

      await serverSync().updateConfig({
        provider: { [result.providerID]: result.config },
        disabled_providers: nextDisabled,
      })
      return result
    },
    onSuccess: (result) => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    },
  }))

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return

    const result = validate()
    if (!result) return
    saveMutation.mutate(result)
  }

  return (
    <div class="flex max-h-[60vh] flex-col gap-5 overflow-y-auto px-2.5 pb-3">
      <div class="flex items-center gap-3 px-2.5">
        <ProviderIcon id="synthetic" class="size-5 shrink-0 text-v2-icon-icon-base" />
        <h2 class="text-[15px] font-[530] tracking-[-0.13px] text-v2-text-text-base">
          {language.t("provider.custom.title")}
        </h2>
      </div>

      <form onSubmit={save} class="flex flex-col gap-5 px-2.5 pb-6">
        <p class="text-[13px] leading-5 text-v2-text-text-muted">{language.t("provider.custom.description.prefix")}</p>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            autofocus={props.autofocus ?? true}
            label={language.t("provider.custom.field.providerID.label")}
            placeholder={language.t("provider.custom.field.providerID.placeholder")}
            description={language.t("provider.custom.field.providerID.description")}
            value={form.providerID}
            error={form.err.providerID}
            mono
            onInput={(value) => setField("providerID", value)}
          />
          <FormField
            label={language.t("provider.custom.field.name.label")}
            placeholder={language.t("provider.custom.field.name.placeholder")}
            value={form.name}
            error={form.err.name}
            onInput={(value) => setField("name", value)}
          />
        </div>
        <FormField
          label={language.t("provider.custom.field.baseURL.label")}
          placeholder={language.t("provider.custom.field.baseURL.placeholder")}
          value={form.baseURL}
          error={form.err.baseURL}
          mono
          onInput={(value) => setField("baseURL", value)}
        />
        <FormField
          label={language.t("provider.custom.field.apiKey.label")}
          placeholder={language.t("provider.custom.field.apiKey.placeholder")}
          description={language.t("provider.custom.field.apiKey.description")}
          value={form.apiKey}
          mono
          onInput={(value) => setField("apiKey", value)}
        />

        <div class="flex flex-col gap-2">
          <span class="ms-1 text-[12px] font-[530] text-v2-text-text-muted">
            {language.t("provider.custom.models.label")}
          </span>
          <div class="flex flex-col gap-0.5 overflow-hidden rounded-[16px]">
            <For each={form.models}>
              {(m, i) => (
                <div class="flex items-start gap-1.5 bg-v2-background-bg-layer-02 p-1.5 ps-2" data-row={m.row}>
                  <RowInput
                    label={language.t("provider.custom.models.id.label")}
                    placeholder={language.t("provider.custom.models.id.placeholder")}
                    value={m.id}
                    error={m.err.id}
                    mono
                    onInput={(value) => setModel(i(), "id", value)}
                  />
                  <RowInput
                    label={language.t("provider.custom.models.name.label")}
                    placeholder={language.t("provider.custom.models.name.placeholder")}
                    value={m.name}
                    error={m.err.name}
                    onInput={(value) => setModel(i(), "name", value)}
                  />
                  <IconButtonV2
                    type="button"
                    variant="ghost-muted"
                    class="mt-0.5 shrink-0"
                    icon={<Icon name="close" />}
                    onClick={() => removeModel(i())}
                    disabled={form.models.length <= 1}
                    aria-label={language.t("provider.custom.models.remove")}
                  />
                </div>
              )}
            </For>
          </div>
          <ButtonV2 type="button" size="small" variant="ghost" icon="plus" onClick={addModel} class="self-start">
            {language.t("provider.custom.models.add")}
          </ButtonV2>
        </div>

        <div class="flex flex-col gap-2">
          <span class="ms-1 text-[12px] font-[530] text-v2-text-text-muted">
            {language.t("provider.custom.headers.label")}
          </span>
          <div class="flex flex-col gap-0.5 overflow-hidden rounded-[16px]">
            <For each={form.headers}>
              {(h, i) => (
                <div class="flex items-start gap-1.5 bg-v2-background-bg-layer-02 p-1.5 ps-2" data-row={h.row}>
                  <RowInput
                    label={language.t("provider.custom.headers.key.label")}
                    placeholder={language.t("provider.custom.headers.key.placeholder")}
                    value={h.key}
                    error={h.err.key}
                    mono
                    onInput={(value) => setHeader(i(), "key", value)}
                  />
                  <RowInput
                    label={language.t("provider.custom.headers.value.label")}
                    placeholder={language.t("provider.custom.headers.value.placeholder")}
                    value={h.value}
                    error={h.err.value}
                    mono
                    onInput={(value) => setHeader(i(), "value", value)}
                  />
                  <IconButtonV2
                    type="button"
                    variant="ghost-muted"
                    class="mt-0.5 shrink-0"
                    icon={<Icon name="close" />}
                    onClick={() => removeHeader(i())}
                    disabled={form.headers.length <= 1}
                    aria-label={language.t("provider.custom.headers.remove")}
                  />
                </div>
              )}
            </For>
          </div>
          <ButtonV2 type="button" size="small" variant="ghost" icon="plus" onClick={addHeader} class="self-start">
            {language.t("provider.custom.headers.add")}
          </ButtonV2>
        </div>

        <ButtonV2 class="self-end" type="submit" variant="contrast" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
        </ButtonV2>
      </form>
    </div>
  )
}

function FormField(props: {
  label: string
  placeholder: string
  value: string
  description?: string
  error?: string
  mono?: boolean
  autofocus?: boolean
  onInput: (value: string) => void
}) {
  return (
    <Field invalid={!!props.error} class="flex min-w-0 flex-col gap-1.5">
      <Field.Label class="ms-1">{props.label}</Field.Label>
      <Show when={props.description}>
        <Field.Prefix class="ms-1">{props.description}</Field.Prefix>
      </Show>
      <TextInputV2
        autofocus={props.autofocus}
        appearance="large"
        class={`${filledFieldClass} ${props.mono ? "[&_input]:font-mono" : ""}`}
        placeholder={props.placeholder}
        value={props.value}
        invalid={!!props.error}
        spellcheck={false}
        autocomplete="off"
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      <Show when={props.error}>
        <Field.Suffix class="ms-1 text-v2-state-fg-danger">{props.error}</Field.Suffix>
      </Show>
    </Field>
  )
}

function RowInput(props: {
  label: string
  placeholder: string
  value: string
  error?: string
  mono?: boolean
  onInput: (value: string) => void
}) {
  return (
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <TextInputV2
        aria-label={props.label}
        class={`!h-9 !w-full !bg-v2-background-bg-layer-01 !shadow-none ${props.mono ? "[&_input]:font-mono" : ""}`}
        placeholder={props.placeholder}
        value={props.value}
        invalid={!!props.error}
        spellcheck={false}
        autocomplete="off"
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      <Show when={props.error}>
        <span role="alert" class="ms-1 text-[12px] text-v2-state-fg-danger">
          {props.error}
        </span>
      </Show>
    </div>
  )
}
