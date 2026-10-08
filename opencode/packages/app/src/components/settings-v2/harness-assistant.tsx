import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { readPartText } from "@opencode-ai/session-ui/message-part-text"
import { Harness } from "@opencode-ai/schema/harness"
import { type Component, For, Show, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SDKProvider, useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { createPromptHarnessController } from "@/components/prompt-input/harness-controller"
import { PromptInputHarnessControls } from "@/components/prompt-input/harness-controls"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { Identifier } from "@/utils/id"
import { addHarness, verifyHarness } from "@/utils/server"
import { normalizeSessionInfo } from "@/utils/session"
import { showToast } from "@/utils/toast"
import {
  type HarnessProposal,
  displayedUserText,
  parseProposal,
  proposalKey,
  setupInstructions,
  testResultMessage,
  testResultPrefix,
} from "./harness-assistant-behavior"
import "./settings-v2.css"

// Failed tests are sent back automatically this many times; after that the user decides.
const autoRetryLimit = 3

type TestState =
  | { status: "running"; proposal: HarnessProposal }
  | { status: "passed"; proposal: HarnessProposal; verification: Harness.Verification }
  | { status: "failed"; proposal: HarnessProposal; message: string }

export const DialogHarnessAssistant: Component<{
  directory: string
  onClose: () => void
  onSaved: (entry: Harness.SettingsEntry) => void
}> = (props) => (
  <SDKProvider directory={props.directory}>
    <HarnessAssistant {...props} />
  </SDKProvider>
)

const HarnessAssistant: Component<{
  directory: string
  onClose: () => void
  onSaved: (entry: Harness.SettingsEntry) => void
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const sdk = useSDK()
  const server = () => ({ server: serverSdk().server.http, fetch: platform.fetch })
  const session = () => serverSync().session

  const [selection, setSelection] = createStore({
    harness: Harness.OpenCode,
    model: undefined as Harness.ModelSelection | undefined,
  })
  const [state, setState] = createStore({
    sessionID: undefined as string | undefined,
    input: "",
    sending: false,
    test: undefined as TestState | undefined,
    saving: false,
    responding: undefined as string | undefined,
  })
  const sessionID = () => state.sessionID
  const test = () => state.test
  const tested = { key: "", retries: 0, assistantMessage: "" }

  const harness = createPromptHarnessController({
    current: () => selection.harness,
    set: (harnessInstanceID, model) => setSelection({ harness: harnessInstanceID, model }),
    model: {
      current: () => selection.model,
      set: (model) => setSelection("model", model),
    },
    // The harness is fixed once the chat starts.
    disabled: () => !!sessionID(),
  })

  const messages = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    const data = session().data
    return (data.message[id] ?? []).flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") return []
      const text = (data.part[message.id] ?? [])
        .flatMap((part) => (part.type === "text" ? [readPartText(data.part_text_accum_delta, part)] : []))
        .join("\n")
      const done = message.role === "user" || message.time.completed !== undefined
      return [{ id: message.id, role: message.role, text, done }]
    })
  })
  const busy = () => {
    const id = sessionID()
    // Harness turns can run for minutes; an unfinished assistant reply also counts as busy.
    return state.sending || (!!id && session().data.session_working(id)) || messages().some((message) => !message.done)
  }
  const permission = () => {
    const id = sessionID()
    return id ? session().data.permission[id]?.[0] : undefined
  }
  const lastAssistant = createMemo(() => messages().findLast((message) => message.role === "assistant"))

  const start = async (harnessDriver: Harness.DriverKind | undefined) => {
    const info = normalizeSessionInfo(
      await sdk().api.session.create({
        harnessInstanceID: selection.harness,
        harnessModel: harnessDriver === Harness.OpenCodeDriver ? undefined : selection.model,
        location: { directory: props.directory },
      }),
    )
    if (!info?.id) throw new Error(language.t("harness.assistant.startFailed"))
    session().pin(info.id)
    setState("sessionID", info.id)
    return info.id
  }

  const send = async (text: string) => {
    const harnessDriver = harness.driver()
    setState("sending", true)
    try {
      const existing = sessionID()
      const id = existing ?? (await start(harnessDriver))
      await sdk().api.session.prompt({
        sessionID: id,
        id: Identifier.ascending("message"),
        text: existing ? text : setupInstructions(text),
        harness: harnessDriver !== Harness.OpenCodeDriver,
      })
      void session().sync(id)
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setState("sending", false)
    }
  }

  const submit = () => {
    const text = state.input.trim()
    if (!text || busy()) return
    setState("input", "")
    void send(text)
  }

  const runTest = (proposal: HarnessProposal) => {
    setState("test", { status: "running", proposal })
    void verifyHarness(server(), props.directory, {
      command: proposal.command,
      args: proposal.args,
      model: proposal.model,
    })
      .then((verification) => {
        if (verification.ok) {
          setState("test", { status: "passed", proposal, verification })
          return
        }
        const message = testResultMessage({ verification })
        setState("test", { status: "failed", proposal, message })
        return retry(message)
      })
      .catch((error: unknown) => {
        const message = testResultMessage({ error: error instanceof Error ? error.message : String(error) })
        setState("test", { status: "failed", proposal, message })
        return retry(message)
      })
  }

  const retry = (message: string) => {
    if (tested.retries >= autoRetryLimit) return
    tested.retries += 1
    void send(message)
  }

  // Test each new proposal once the assistant has finished its reply.
  createEffect(
    on([busy, lastAssistant], ([isBusy, message]) => {
      if (isBusy || !message || message.id === tested.assistantMessage) return
      tested.assistantMessage = message.id
      const proposal = parseProposal(message.text)
      if (!proposal || proposalKey(proposal) === tested.key) return
      tested.key = proposalKey(proposal)
      runTest(proposal)
    }),
  )

  const save = () => {
    const passed = state.test
    if (passed?.status !== "passed" || state.saving) return
    setState("saving", true)
    void addHarness(server(), props.directory, {
      id: passed.proposal.id,
      name: passed.proposal.name,
      command: passed.verification.command,
      args: [...passed.verification.args],
      // The picker defaults to the first model, so the one that passed the test goes first.
      models: [
        ...(passed.proposal.model ? [passed.proposal.model] : []),
        ...passed.verification.models.map((model) => model.id).filter((id) => id !== passed.proposal.model),
      ],
    })
      .then((entry) => {
        props.onSaved(entry)
        props.onClose()
      })
      .catch((error: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setState("saving", false))
  }

  const decide = (response: "once" | "always" | "reject") => {
    const request = permission()
    if (!request || state.responding === request.id) return
    setState("responding", request.id)
    void sdk()
      .api.permission.reply({ sessionID: request.sessionID, requestID: request.id, reply: response })
      .catch((error: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setState("responding", undefined))
  }

  onCleanup(() => {
    const id = sessionID()
    if (!id) return
    if (session().data.session_working(id))
      void sdk()
        .api.session.interrupt({ sessionID: id })
        .catch(() => undefined)
    session().unpin(id)
  })

  return (
    <Dialog fit class="settings-v2-server-dialog settings-v2-harness-assistant">
      <DialogHeader hideClose={true}>
        <DialogTitle>{language.t("harness.assistant.title")}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-3 px-4 pt-4 pb-2">
        <div class="flex flex-wrap items-center gap-2" data-component="harness-assistant-picker">
          <span class="settings-v2-harness-detail shrink-0 whitespace-nowrap">
            {language.t("harness.assistant.runsOn")}
          </span>
          <PromptInputHarnessControls controller={harness} />
        </div>
        <div class="settings-v2-harness-chat" data-component="harness-assistant-chat">
          <Show
            when={messages().length > 0}
            fallback={<div class="settings-v2-harness-detail">{language.t("harness.assistant.intro")}</div>}
          >
            <For each={messages()}>
              {(message) => (
                <Show
                  when={message.role === "assistant"}
                  fallback={
                    <Show
                      when={!message.text.startsWith(testResultPrefix)}
                      fallback={<div class="settings-v2-harness-detail">{message.text}</div>}
                    >
                      <div class="settings-v2-harness-user" data-role="user">
                        {displayedUserText(message.text)}
                      </div>
                    </Show>
                  }
                >
                  <div data-role="assistant">
                    <Markdown
                      text={message.text}
                      cacheKey={message.id}
                      streaming={busy() && lastAssistant()?.id === message.id}
                    />
                  </div>
                </Show>
              )}
            </For>
          </Show>
          <Show when={busy() && !permission()}>
            <div class="settings-v2-harness-detail">{language.t("harness.assistant.working")}</div>
          </Show>
        </div>
        <Show when={permission()}>
          {(request) => (
            <SessionPermissionDock
              request={request()}
              responding={state.responding === request().id}
              onDecide={decide}
            />
          )}
        </Show>
        <Show when={test()}>
          {(state) => (
            <div class="settings-v2-harness-test" data-component="harness-test" data-status={state().status}>
              <div class="settings-v2-provider-name">
                {state().proposal.name ?? state().proposal.id}{" "}
                <span class="settings-v2-harness-detail">
                  {[state().proposal.command, ...state().proposal.args].join(" ")}
                  <Show when={state().proposal.model}>{(model) => ` · ${model()}`}</Show>
                </span>
              </div>
              <Show when={state().status === "running"}>
                <div class="settings-v2-harness-detail">{language.t("harness.assistant.testing")}</div>
              </Show>
              <Show when={state().status === "passed" && state()} keyed>
                {(passed) =>
                  passed.status === "passed" && (
                    <div class="settings-v2-harness-detail">
                      {language.t("harness.assistant.passed", {
                        agent: passed.verification.agentName ?? passed.verification.command,
                        count: passed.verification.models.length,
                        reply: passed.verification.reply.slice(0, 120),
                      })}
                    </div>
                  )
                }
              </Show>
              <Show when={state().status === "failed" && state()} keyed>
                {(failed) =>
                  failed.status === "failed" && (
                    <div role="alert" class="settings-v2-server-dialog-error">
                      {failed.message.slice(testResultPrefix.length).trim()}
                    </div>
                  )
                }
              </Show>
            </div>
          )}
        </Show>
        <TextInputV2
          type="text"
          appearance="large"
          class="!w-full self-stretch"
          id="harness-assistant-input"
          value={state.input}
          placeholder={language.t(sessionID() ? "harness.assistant.followUp" : "harness.assistant.placeholder")}
          disabled={busy()}
          onInput={(event) => setState("input", event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.isComposing) return
            event.preventDefault()
            submit()
          }}
        />
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={state.saving} onClick={props.onClose}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="neutral" disabled={busy() || !state.input.trim()} onClick={submit}>
          {language.t("harness.assistant.send")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={test()?.status !== "passed" || state.saving} onClick={save}>
          {language.t("common.save")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
