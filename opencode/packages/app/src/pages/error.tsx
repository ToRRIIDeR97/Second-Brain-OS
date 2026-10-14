import * as Sentry from "@sentry/solid"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Component, createSignal, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { errorDescriptionKey } from "./error-description"

export type InitError = {
  name: string
  data: Record<string, unknown>
}

type Translator = ReturnType<typeof useLanguage>["t"]
const CHAIN_SEPARATOR = "\n" + "─".repeat(40) + "\n"

function isIssue(value: unknown): value is { message: string; path: string[] } {
  if (!value || typeof value !== "object") return false
  if (!("message" in value) || !("path" in value)) return false
  const message = (value as { message: unknown }).message
  const path = (value as { path: unknown }).path
  if (typeof message !== "string") return false
  if (!Array.isArray(path)) return false
  return path.every((part) => typeof part === "string")
}

function isInitError(error: unknown): error is InitError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    "data" in error &&
    typeof (error as InitError).data === "object"
  )
}

function safeJson(value: unknown, circular: string): string {
  const seen = new WeakSet<object>()
  const json = JSON.stringify(
    value,
    (_key, val) => {
      if (typeof val === "bigint") return val.toString()
      if (typeof val === "object" && val) {
        if (seen.has(val)) return circular
        seen.add(val)
      }
      return val
    },
    2,
  )
  return json ?? String(value)
}

function formatInitError(error: InitError, t: Translator): string {
  const data = error.data
  const json = (value: unknown) => safeJson(value, t("error.page.circular"))
  switch (error.name) {
    case "MCPFailed": {
      const name = typeof data.name === "string" ? data.name : ""
      return t("error.chain.mcpFailed", { name })
    }
    case "ProviderAuthError": {
      const providerID = typeof data.providerID === "string" ? data.providerID : t("common.unknown")
      const message = typeof data.message === "string" ? data.message : json(data.message)
      return t("error.chain.providerAuthFailed", { provider: providerID, message })
    }
    case "APIError": {
      const message = typeof data.message === "string" ? data.message : t("error.chain.apiError")
      const lines: string[] = [message]

      if (typeof data.statusCode === "number") {
        lines.push(t("error.chain.status", { status: data.statusCode }))
      }

      if (typeof data.isRetryable === "boolean") {
        lines.push(t("error.chain.retryable", { retryable: data.isRetryable }))
      }

      if (typeof data.responseBody === "string" && data.responseBody) {
        lines.push(t("error.chain.responseBody", { body: data.responseBody }))
      }

      return lines.join("\n")
    }
    case "ProviderModelNotFoundError": {
      const { providerID, modelID, suggestions } = data as {
        providerID: string
        modelID: string
        suggestions?: string[]
      }

      const suggestionsLine =
        Array.isArray(suggestions) && suggestions.length
          ? [t("error.chain.didYouMean", { suggestions: suggestions.join(", ") })]
          : []

      return [
        t("error.chain.modelNotFound", { provider: providerID, model: modelID }),
        ...suggestionsLine,
        t("error.chain.checkConfig"),
      ].join("\n")
    }
    case "ProviderInitError": {
      const providerID = typeof data.providerID === "string" ? data.providerID : t("common.unknown")
      return t("error.chain.providerInitFailed", { provider: providerID })
    }
    case "ConfigJsonError": {
      const path = typeof data.path === "string" ? data.path : json(data.path)
      const message = typeof data.message === "string" ? data.message : ""
      if (message) return t("error.chain.configJsonInvalidWithMessage", { path, message })
      return t("error.chain.configJsonInvalid", { path })
    }
    case "ConfigDirectoryTypoError": {
      const path = typeof data.path === "string" ? data.path : json(data.path)
      const dir = typeof data.dir === "string" ? data.dir : json(data.dir)
      const suggestion = typeof data.suggestion === "string" ? data.suggestion : json(data.suggestion)
      return t("error.chain.configDirectoryTypo", { dir, path, suggestion })
    }
    case "ConfigFrontmatterError": {
      const path = typeof data.path === "string" ? data.path : json(data.path)
      const message = typeof data.message === "string" ? data.message : json(data.message)
      return t("error.chain.configFrontmatterError", { path, message })
    }
    case "ConfigInvalidError": {
      const issues = Array.isArray(data.issues)
        ? data.issues.filter(isIssue).map((issue) => "↳ " + issue.message + " " + issue.path.join("."))
        : []
      const message = typeof data.message === "string" ? data.message : ""
      const path = typeof data.path === "string" ? data.path : json(data.path)

      const line = message
        ? t("error.chain.configInvalidWithMessage", { path, message })
        : t("error.chain.configInvalid", { path })

      return [line, ...issues].join("\n")
    }
    case "UnknownError":
      return typeof data.message === "string" ? data.message : json(data)
    default:
      if (typeof data.message === "string") return data.message
      return json(data)
  }
}

function formatErrorChain(error: unknown, t: Translator, depth = 0, parentMessage?: string): string {
  const json = (value: unknown) => safeJson(value, t("error.page.circular"))
  if (!error) return t("error.chain.unknown")

  if (isInitError(error)) {
    const message = formatInitError(error, t)
    if (depth > 0 && parentMessage === message) return ""
    const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}${t("error.chain.causedBy")}\n` : ""
    return indent + `${error.name}\n${message}`
  }

  if (error instanceof Error) {
    const isDuplicate = depth > 0 && parentMessage === error.message
    const parts: string[] = []
    const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}${t("error.chain.causedBy")}\n` : ""

    const header = `${error.name}${error.message ? `: ${error.message}` : ""}`
    const stack = error.stack?.trim()

    if (stack) {
      const startsWithHeader = stack.startsWith(header)

      if (isDuplicate && startsWithHeader) {
        const trace = stack.split("\n").slice(1).join("\n").trim()
        if (trace) {
          parts.push(indent + trace)
        }
      }

      if (isDuplicate && !startsWithHeader) {
        parts.push(indent + stack)
      }

      if (!isDuplicate && startsWithHeader) {
        parts.push(indent + stack)
      }

      if (!isDuplicate && !startsWithHeader) {
        parts.push(indent + `${header}\n${stack}`)
      }
    }

    if (!stack && !isDuplicate) {
      parts.push(indent + header)
    }

    if (error.cause) {
      const causeResult = formatErrorChain(error.cause, t, depth + 1, error.message)
      if (causeResult) {
        parts.push(causeResult)
      }
    }

    return parts.join("\n\n")
  }

  if (typeof error === "string") {
    if (depth > 0 && parentMessage === error) return ""
    const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}${t("error.chain.causedBy")}\n` : ""
    return indent + error
  }

  const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}${t("error.chain.causedBy")}\n` : ""
  return indent + json(error)
}

function formatError(error: unknown, t: Translator): string {
  return formatErrorChain(error, t, 0)
}

interface ErrorPageProps {
  error: unknown
}

export const ErrorPage: Component<ErrorPageProps> = (props) => {
  const platform = usePlatform()
  const language = useLanguage()
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  const formattedError = () => formatError(props.error, language.t)
  let recordedFatalError: Promise<void> | undefined
  const [store, setStore] = createStore({
    actionError: undefined as string | undefined,
  })

  function ensureFatalErrorRecorded() {
    recordedFatalError ??=
      platform.recordFatalRendererError?.({
        error: formattedError(),
        url: location.href,
        version: platform.version,
        platform: platform.platform,
        os: platform.os,
      }) ?? Promise.resolve()
    return recordedFatalError
  }

  onMount(() => {
    void ensureFatalErrorRecorded().catch(() => undefined)
  })

  async function checkForUpdates() {
    const state = await platform.updater?.check()
    setStore("actionError", state?.status === "error" ? state.message : undefined)
  }

  async function installUpdate() {
    await platform.updater
      ?.install()
      .then(() => setStore("actionError", undefined))
      .catch((err) => {
        setStore("actionError", formatError(err, language.t))
      })
  }

  const updateVersion = () => {
    const state = platform.updater?.state()
    if (state?.status !== "ready") return
    return state.version
  }

  async function exportDebugLogs() {
    const exportLogs = platform.exportDebugLogs
    if (!exportLogs) return
    await ensureFatalErrorRecorded()
      .then(() => exportLogs())
      .then(() => setStore("actionError", undefined))
      .catch((err) => {
        setStore("actionError", formatError(err, language.t))
      })
  }

  const copyDetails = () =>
    navigator.clipboard
      .writeText(formattedError())
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => undefined)

  return (
    <div
      class="relative flex h-screen w-screen min-h-0 flex-1 flex-col items-center justify-center bg-v2-background-bg-deep p-4 font-sans"
      data-tauri-drag-region
    >
      <div class="flex w-full max-w-2xl flex-col items-center gap-6">
        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-[22px] font-[600] leading-7 text-v2-text-text-base">{language.t("error.page.title")}</h1>
          <p class="text-[14px] leading-5 text-v2-text-text-muted">{language.t(errorDescriptionKey(props.error))}</p>
        </div>
        <div class="relative w-full rounded-[20px] bg-v2-background-bg-layer-01 shadow-[0_0_0_0.5px_var(--v2-border-border-muted)]">
          <pre
            class="no-scrollbar max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 pr-12 font-mono text-[12px] leading-5 text-v2-text-text-base select-text"
            aria-label={language.t("error.page.details.label")}
            tabIndex={0}
          >
            {formattedError()}
          </pre>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            class="absolute right-2 top-2"
            icon={<Icon name={copied() ? "check" : "outline-copy"} />}
            onClick={() => void copyDetails()}
            aria-label={i18n.t(copied() ? "ui.textField.copied" : "ui.textField.copyToClipboard")}
          />
        </div>
        <div class="flex flex-row flex-wrap items-center justify-center gap-2">
          <ButtonV2 size="large" variant="contrast" onClick={platform.restart}>
            {language.t("error.page.action.restart")}
          </ButtonV2>
          <Show when={platform.platform === "desktop" && platform.exportDebugLogs}>
            <ButtonV2 size="large" variant="neutral" onClick={exportDebugLogs}>
              {language.t("error.page.action.exportLogs")}
            </ButtonV2>
          </Show>
          <Show when={Sentry.isEnabled}>
            {(_) => {
              const [reported, setReported] = createSignal(false)
              return (
                <ButtonV2
                  size="large"
                  variant="neutral"
                  disabled={reported()}
                  onClick={() => {
                    Sentry.captureException(props.error)
                    setReported(true)
                  }}
                >
                  {language.t(reported() ? "error.page.action.reported" : "error.page.action.report")}
                </ButtonV2>
              )
            }}
          </Show>
          <Show when={platform.updater}>
            <Show
              when={updateVersion()}
              fallback={
                <ButtonV2
                  size="large"
                  variant="ghost"
                  onClick={checkForUpdates}
                  disabled={["checking", "downloading", "installing"].includes(platform.updater?.state().status ?? "")}
                >
                  {platform.updater?.state().status === "checking"
                    ? language.t("error.page.action.checking")
                    : language.t("error.page.action.checkUpdates")}
                </ButtonV2>
              }
            >
              {(version) => (
                <ButtonV2 size="large" variant="neutral" onClick={installUpdate}>
                  {language.t("error.page.action.updateTo", { version: version() })}
                </ButtonV2>
              )}
            </Show>
          </Show>
        </div>
        <Show when={store.actionError}>
          {(message) => (
            <p role="alert" class="max-w-2xl text-center text-[12px] leading-4 text-v2-state-fg-danger">
              {message()}
            </p>
          )}
        </Show>
        <Show when={platform.version}>
          {(version) => (
            <p class="text-[12px] leading-4 text-v2-text-text-faint">
              {language.t("error.page.version", { version: version() })}
            </p>
          )}
        </Show>
      </div>
    </div>
  )
}
