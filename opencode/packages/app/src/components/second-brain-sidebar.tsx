import { useLocation, useNavigate } from "@solidjs/router"
import { For } from "solid-js"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSettingsDialog } from "@/components/settings-dialog"

export function SecondBrainSidebar() {
  const language = useLanguage()
  const layout = useLayout()
  const location = useLocation()
  const navigate = useNavigate()
  const openSettings = useSettingsDialog()
  const items = () => [
    {
      id: "overview",
      icon: "grid-plus",
      label: language.t("secondBrain.sidebar.overview"),
      active: location.pathname === "/brain",
      disabled: false,
      run: () => navigate("/brain"),
    },
    {
      id: "projects",
      icon: "workspace",
      label: language.t("secondBrain.sidebar.projects"),
      active: location.pathname === "/projects",
      disabled: false,
      run: () => navigate("/projects"),
    },
    {
      id: "calendar",
      icon: "status",
      label: language.t("secondBrain.sidebar.calendar"),
      active: location.pathname === "/calendar",
      disabled: false,
      run: () => navigate("/calendar"),
    },
    {
      id: "notes",
      icon: "edit",
      label: language.t("secondBrain.sidebar.notes"),
      active: location.pathname === "/notes",
      disabled: false,
      run: () => navigate("/notes"),
    },
    {
      id: "activity",
      icon: "status",
      label: language.t("secondBrain.sidebar.activity"),
      active: location.pathname === "/activity",
      disabled: false,
      run: () => navigate("/activity"),
    },
  ]

  return (
    <aside
      data-component="second-brain-sidebar"
      data-expanded={layout.sidebar.opened() ? "" : undefined}
      classList={{
        "hidden md:flex shrink-0 min-h-0 flex-col overflow-hidden bg-v2-background-bg-deep transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none": true,
        "w-[244px]": layout.sidebar.opened(),
        "w-12": !layout.sidebar.opened(),
      }}
      aria-label={language.t("secondBrain.sidebar.title")}
    >
      <div class="grid h-11 shrink-0 grid-cols-[32px_1fr] items-center px-2">
        <div class="flex size-8 items-center justify-center text-v2-icon-icon-muted">
          <Icon name="grid-plus" size="small" />
        </div>
        <span
          classList={{
            "min-w-0 truncate pl-1 text-[13px] text-v2-text-text-muted [font-weight:530] transition-[opacity,transform] motion-reduce:transition-none": true,
            "translate-x-0 opacity-100 duration-180 ease-out": layout.sidebar.opened(),
            "pointer-events-none -translate-x-1 opacity-0 duration-120 ease-in": !layout.sidebar.opened(),
          }}
        >
          {language.t("secondBrain.sidebar.title")}
        </span>
      </div>

      <nav class="flex min-h-0 flex-1 flex-col gap-1 px-2 py-1">
        <For each={items()}>
          {(item) => (
            <TooltipV2 placement="right" value={item.label} inactive={layout.sidebar.opened()}>
              <button
                type="button"
                data-sidebar-item={item.id}
                data-selected={item.active ? "" : undefined}
                classList={{
                  "grid h-8 w-full min-w-0 shrink-0 cursor-default grid-cols-[32px_1fr] items-center overflow-hidden rounded-[6px] bg-transparent text-left text-[13px] text-v2-text-text-muted [font-weight:440] transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base data-[selected]:hover:bg-v2-background-bg-layer-03 focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]": true,
                  "cursor-not-allowed opacity-45": item.disabled,
                }}
                onClick={item.run}
                disabled={item.disabled}
                aria-current={item.active ? "page" : undefined}
                aria-label={item.label}
              >
                <span class="flex size-8 items-center justify-center text-v2-icon-icon-muted">
                  <Icon name={item.icon} size="small" />
                </span>
                <span
                  classList={{
                    "min-w-0 truncate pl-1 transition-[opacity,transform] motion-reduce:transition-none": true,
                    "translate-x-0 opacity-100 duration-180 ease-out": layout.sidebar.opened(),
                    "pointer-events-none -translate-x-1 opacity-0 duration-120 ease-in": !layout.sidebar.opened(),
                  }}
                >
                  {item.label}
                </span>
              </button>
            </TooltipV2>
          )}
        </For>
      </nav>

      <div class="shrink-0 px-2 pb-5 pt-2">
        <TooltipV2 placement="right" value={language.t("sidebar.settings")} inactive={layout.sidebar.opened()}>
          <button
            type="button"
            class="grid h-8 w-full min-w-0 shrink-0 cursor-default grid-cols-[32px_1fr] items-center overflow-hidden rounded-[6px] bg-transparent text-left text-[13px] text-v2-text-text-faint [font-weight:440] transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_0.5px_var(--v2-border-border-muted)]"
            onClick={openSettings}
            aria-label={language.t("sidebar.settings")}
          >
            <span class="flex size-8 items-center justify-center text-v2-icon-icon-muted">
              <Icon name="settings-gear" size="small" />
            </span>
            <span
              classList={{
                "min-w-0 truncate pl-1 transition-[opacity,transform] motion-reduce:transition-none": true,
                "translate-x-0 opacity-100 duration-180 ease-out": layout.sidebar.opened(),
                "pointer-events-none -translate-x-1 opacity-0 duration-120 ease-in": !layout.sidebar.opened(),
              }}
            >
              {language.t("sidebar.settings")}
            </span>
          </button>
        </TooltipV2>
      </div>
    </aside>
  )
}
