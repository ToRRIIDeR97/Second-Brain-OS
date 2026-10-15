import { Component, createMemo, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useLanguage } from "@/context/language"
import { useMcpToggle } from "@/context/mcp"
import { listV2Class, statusDotClass } from "./surface-classes"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_client_registration",
  disabled: "mcp.status.disabled",
} as const

export const DialogSelectMcp: Component = () => {
  const sync = useSync()
  const language = useLanguage()

  const items = createMemo(() =>
    Object.entries(sync().data.mcp ?? {})
      .map(([name, status]) => ({ name, status: status.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = useMcpToggle()

  const enabledCount = createMemo(() => items().filter((i) => i.status === "connected").length)
  const totalCount = createMemo(() => items().length)

  return (
    <Dialog size="large">
      <DialogHeader>
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <DialogTitle>{language.t("dialog.mcp.title")}</DialogTitle>
          <Tag class="shrink-0">
            {language.t("dialog.mcp.description", { enabled: enabledCount(), total: totalCount() })}
          </Tag>
        </div>
      </DialogHeader>
      <DialogBody class="min-h-0">
        <List
          class={`flex-1 min-h-0 px-3 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0 ${listV2Class}`}
          search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
          emptyMessage={language.t("dialog.mcp.empty")}
          key={(x) => x?.name ?? ""}
          items={items}
          filterKeys={["name", "status"]}
          sortBy={(a, b) => a.name.localeCompare(b.name)}
          onSelect={(x) => {
            if (!x || x.status === "pending" || toggle.isPending) return
            toggle.mutate(x.name)
          }}
        >
          {(i) => {
            const mcpStatus = () => sync().data.mcp[i.name]
            const status = () => mcpStatus()?.status
            const statusLabel = () => {
              const key = status() ? statusLabels[status() as keyof typeof statusLabels] : undefined
              if (!key) return
              return language.t(key)
            }
            const error = () => {
              const s = mcpStatus()
              if (s?.status === "failed" || s?.status === "needs_client_registration") return s.error
            }
            const enabled = () => status() === "connected"
            return (
              <div class="flex w-full items-center gap-2.5">
                <span class={`size-2 shrink-0 rounded-full ${statusDotClass(status())}`} />
                <div class="flex min-w-0 flex-1 flex-col gap-px">
                  <span class="truncate [font-weight:530]">{i.name}</span>
                  <Show when={error() ?? statusLabel()}>
                    {(line) => (
                      <span
                        class="truncate text-[12px] opacity-70"
                        classList={{ "text-v2-text-text-critical !opacity-100": !!error() }}
                      >
                        {line()}
                      </span>
                    )}
                  </Show>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={enabled()}
                    disabled={status() === "pending" || (toggle.isPending && toggle.variables === i.name)}
                    onChange={() => {
                      if (toggle.isPending) return
                      toggle.mutate(i.name)
                    }}
                    hideLabel
                  >
                    {i.name}
                  </Switch>
                </div>
              </div>
            )
          }}
        </List>
      </DialogBody>
    </Dialog>
  )
}
