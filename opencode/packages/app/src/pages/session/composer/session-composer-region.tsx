import { Show, createMemo, untrack, type JSX } from "solid-js"
import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"
import { Reveal } from "@opencode-ai/ui/v2/reveal"
import { useLanguage } from "@/context/language"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionRevertTray } from "@/pages/session/composer/session-revert-dock"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"
import type { SessionComposerFollowupDock } from "./session-composer-region-controller"
import type { SessionComposerRegionController } from "./session-composer-region-controller"

export function SessionComposerRegion(props: {
  controller: SessionComposerRegionController
  promptInput: JSX.Element
}) {
  const language = useLanguage()
  const controller = props.controller
  // Each dock opens and closes through Reveal, so the region's height eases instead of jumping. A closing
  // dock keeps rendering the last value it had, which these hold once the live value is gone.
  const question = createMemo<QuestionRequest | undefined>((last) => controller.state.questionRequest() ?? last)
  const permission = createMemo<PermissionRequest | undefined>((last) => controller.state.permissionRequest() ?? last)
  const followup = createMemo<SessionComposerFollowupDock | undefined>((last) =>
    controller.followup()?.items.length ? controller.followup() : last,
  )

  // A composer that replaces the handoff placeholder (the prompt was still loading) fades in over it; one
  // that is ready from the start does not.
  const handedOff = !untrack(controller.promptReady)

  return (
    <div
      ref={controller.setDockRef}
      data-component="session-prompt-dock"
      class="w-full shrink-0 flex flex-col justify-center items-center pb-3 pointer-events-none bg-v2-background-bg-base"
    >
      <div
        classList={{
          "w-full px-3 pointer-events-auto flex flex-col": true,
          "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": controller.centered(),
        }}
      >
        {/* A question or permission takes the composer's place: the dock grows in as the composer folds away,
            and the reverse once it is answered. */}
        <Reveal open={!!controller.state.questionRequest()}>
          <Show when={question()} keyed>
            {(request) => <SessionQuestionDock request={request} onSubmit={controller.onResponseSubmit} />}
          </Show>
        </Reveal>

        <Reveal open={!!controller.state.permissionRequest()}>
          <Show when={permission()} keyed>
            {(request) => (
              <SessionPermissionDock
                request={request}
                responding={controller.state.permissionResponding()}
                onDecide={(response) => {
                  controller.onResponseSubmit()
                  controller.state.decide(response)
                }}
              />
            )}
          </Show>
        </Reveal>

        <Reveal open={controller.showComposer()}>
          {/* Flex so the docks' negative margins add up instead of collapsing into each other. */}
          <div class="flex flex-col">
            <Show when={controller.dock()}>
              <div
                classList={{
                  "overflow-hidden": true,
                  "pointer-events-none": controller.dockProgress() < 0.98,
                }}
                style={{
                  "max-height": `${controller.dockHeight() * controller.dockProgress()}px`,
                }}
              >
                <div ref={controller.setDockBodyRef}>
                  <SessionTodoDock
                    todos={controller.state.todos()}
                    collapsed={controller.todo.collapsed()}
                    onToggle={controller.todo.onToggle}
                    collapseLabel={language.t("session.todo.collapse")}
                    expandLabel={language.t("session.todo.expand")}
                    dockProgress={controller.dockProgress()}
                  />
                </div>
              </div>
            </Show>
            <Show
              when={controller.promptReady()}
              fallback={
                <div style={{ "margin-top": `${-36 * controller.dockProgress()}px` }}>
                  {/* The live composer carries the rollback rows in its own tray; the placeholder stands in for it. */}
                  <SessionRevertTray dock={controller.revert} />
                  <div class="w-full min-h-32 md:min-h-40 rounded-[28px] bg-v2-background-bg-layer-01 px-5 py-4 text-v2-text-text-faint whitespace-pre-wrap pointer-events-none">
                    {controller.handoffPrompt() || language.t("prompt.loading")}
                  </div>
                </div>
              }
            >
              {/* The rollback rows live in the composer's tray (its header), so they fold in with the tray
                  and the composer below them never jumps. */}
              <div
                classList={{
                  "relative z-[70]": true,
                  "animate-in fade-in duration-short ease-standard motion-reduce:animate-none": handedOff,
                }}
                style={{ "margin-top": `${-36 * controller.dockProgress()}px` }}
              >
                <Reveal open={!!controller.followup()?.items.length}>
                  <Show when={followup()}>
                    {(dock) => (
                      <SessionFollowupDock items={dock().items} pending={dock().pending} actions={dock().actions} />
                    )}
                  </Show>
                </Reveal>
                <Show when={controller.child()} fallback={props.promptInput}>
                  <div
                    ref={controller.setPromptRef}
                    class="w-full rounded-[28px] bg-v2-background-bg-layer-01 px-5 py-4 text-[14px] text-v2-text-text-muted"
                  >
                    <span>{language.t("session.child.promptDisabled")} </span>
                    <Show when={controller.parentID()}>
                      <button
                        type="button"
                        class="rounded-full text-v2-text-text-accent transition-colors duration-150 ease-standard hover:text-v2-text-text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus [font-weight:530] motion-reduce:transition-none"
                        onClick={controller.openParent}
                      >
                        {language.t("session.child.backToParent")}
                      </button>
                    </Show>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
