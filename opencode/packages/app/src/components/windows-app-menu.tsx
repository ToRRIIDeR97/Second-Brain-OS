import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"

import { useCommand } from "@/context/command"
import { DESKTOP_MENU, desktopMenuVisible, type DesktopMenuAction, type DesktopMenuEntry } from "@/desktop-menu"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"

export function WindowsAppMenu(props: {
  command: ReturnType<typeof useCommand>
  platform: ReturnType<typeof usePlatform>
}) {
  let lastFocused: HTMLElement | undefined
  const language = useLanguage()

  const rememberFocus = () => {
    const active = document.activeElement
    lastFocused = active instanceof HTMLElement ? active : undefined
  }
  const commandDisabled = (id: string) => {
    const option = props.command.options.find((option) => option.id === id)
    if (!option) return true
    return option.disabled ?? false
  }
  const runCommand = (id: string) => {
    if (commandDisabled(id)) return
    props.command.trigger(id)
  }
  const runAction = (action: DesktopMenuAction) => {
    if (action.startsWith("edit.") && lastFocused?.isConnected) lastFocused.focus({ preventScroll: true })
    void props.platform.runDesktopMenuAction?.(action)
  }
  const runEntry = (entry: DesktopMenuEntry) => {
    if (entry.type === "separator") return
    if (entry.command) {
      runCommand(entry.command)
      return
    }
    if (entry.action) {
      runAction(entry.action)
      return
    }
    if (entry.href) props.platform.openExternal(entry.href)
  }

  return (
    <MenuV2 gutter={4} modal={false} placement="bottom-start">
      <MenuV2.Trigger
        as={IconButtonV2}
        variant="ghost-muted"
        size="large"
        class="shrink-0"
        icon={<Icon name="menu" />}
        aria-label={language.t("desktop.menu.ariaLabel")}
        onPointerDown={rememberFocus}
        onKeyDown={rememberFocus}
      />
      <MenuV2.Portal>
        <MenuV2.Content>
          <MenuV2.Group>
            <MenuV2.GroupLabel>{language.t("desktop.menu.app")}</MenuV2.GroupLabel>
            {DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "windows")).map((menu) => (
              <MenuV2.Sub>
                <MenuV2.SubTrigger>{language.t(menu.labelKey)}</MenuV2.SubTrigger>
                <MenuV2.Portal>
                  <MenuV2.SubContent style={{ "min-width": "240px", "max-width": "min(320px, calc(100vw - 24px))" }}>
                    {menu.items
                      ?.filter((entry) => desktopMenuVisible(entry, "windows"))
                      .map((entry) =>
                        entry.type === "separator" ? (
                          <MenuV2.Separator />
                        ) : (
                          <MenuV2.Item
                            disabled={entry.command ? commandDisabled(entry.command) : false}
                            shortcut={entry.command ? props.command.keybind(entry.command) : entry.accelerator?.windows}
                            onSelect={() => runEntry(entry)}
                          >
                            {entry.labelKey ? language.t(entry.labelKey) : ""}
                          </MenuV2.Item>
                        ),
                      )}
                  </MenuV2.SubContent>
                </MenuV2.Portal>
              </MenuV2.Sub>
            ))}
          </MenuV2.Group>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
