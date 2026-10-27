import { Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { pagePanelClass } from "@/components/page"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useSessionLayout } from "@/pages/session/session-layout"

/** Rail width plus the flex gap before it. */
export const SESSION_SIDE_RAIL_SPACE = 48

/** Shown while the side panel is closed: keeps the change count and context use visible. */
export function SessionSideRail(props: { reviewCount: number; hasReview: boolean }) {
  const command = useCommand()
  const language = useLanguage()
  const { tabs, view } = useSessionLayout()

  const openReview = () => {
    view().reviewPanel.open()
    tabs().setActive("review")
  }

  return (
    <nav
      aria-label={language.t("session.panel.reviewAndFiles")}
      class={`flex h-full w-10 shrink-0 flex-col items-center gap-1 py-2 ${pagePanelClass}`}
    >
      <TooltipV2
        placement="left"
        value={
          <>
            {language.t("secondBrain.sidePanel.showReview")}
            <Show when={command.keybindParts("review.toggle").length > 0}>
              <KeybindV2 keys={command.keybindParts("review.toggle")} variant="neutral" />
            </Show>
          </>
        }
      >
        <div class="relative">
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            icon={<Icon name="review" />}
            onClick={openReview}
            aria-label={language.t("secondBrain.sidePanel.showReview")}
            aria-controls="review-panel"
            aria-expanded={false}
          />
          <Show when={props.hasReview}>
            <span class="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-v2-icon-icon-accent px-1 text-[9px] font-semibold tabular-nums text-v2-background-bg-base">
              {props.reviewCount}
            </span>
          </Show>
        </div>
      </TooltipV2>
      <SessionContextUsage buttonAppearance="v2" placement="left" />
    </nav>
  )
}
