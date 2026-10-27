import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { SegmentedControlItemV2, SegmentedControlV2 } from "@opencode-ai/ui/v2/segmented-control-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { showToast } from "@/utils/toast"
import { useNavigate } from "@solidjs/router"
import { type Accessor, createEffect, createMemo, For, type JSXElement, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { popoverSurfaceClass, statusDotClass, switchRowClass } from "./surface-classes"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { type ServerHealth } from "@/utils/server-health"
import { useGlobal } from "@/context/global"
import { useMcpToggle } from "@/context/mcp"
import { useServerProtocol } from "@/context/server-sdk"

const pluginEmptyMessage = (value: string, file: string): JSXElement => {
  const parts = value.split(file)
  if (parts.length === 1) return value
  return (
    <>
      {parts[0]}
      <code class="rounded-[8px] bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-v2-text-text-base">{file}</code>
      {parts.slice(1).join(file)}
    </>
  )
}

const listServersByHealth = (
  list: ServerConnection.Any[],
  active: ServerConnection.Key | undefined,
  status: Record<ServerConnection.Key, ServerHealth | undefined>,
) => {
  if (!list.length) return list
  const order = new Map(list.map((url, index) => [url, index] as const))
  const rank = (value?: ServerHealth) => {
    if (value?.healthy === true) return 0
    if (value?.healthy === false) return 2
    return 1
  }

  return list.slice().sort((a, b) => {
    if (ServerConnection.key(a) === active) return -1
    if (ServerConnection.key(b) === active) return 1
    const diff = rank(status[ServerConnection.key(a)]) - rank(status[ServerConnection.key(b)])
    if (diff !== 0) return diff
    return (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
}

const useDefaultServerKey = (
  get: (() => string | Promise<string | null | undefined> | null | undefined) | undefined,
) => {
  const [state, setState] = createStore({
    key: undefined as ServerConnection.Key | undefined,
    tick: 0,
  })

  createEffect(() => {
    state.tick
    let dead = false
    const result = get?.()
    if (!result) {
      setState("key", undefined)
      onCleanup(() => {
        dead = true
      })
      return
    }

    if (result instanceof Promise) {
      void result.then((next) => {
        if (dead) return
        setState("key", next ?? undefined)
      })
      onCleanup(() => {
        dead = true
      })
      return
    }

    setState("key", ServerConnection.Key.make(result))
    onCleanup(() => {
      dead = true
    })
  })

  return {
    key: () => {
      return state.key
    },
    refresh: () => setState("tick", (value) => value + 1),
  }
}

type ServerStatusState = {
  servers: () => ServerStatusItem[]
  defaultKey: () => ServerConnection.Key | undefined
  ariaLabel: string
  serversLabel: string
  defaultLabel: string
  manageLabel: string
  onManage: () => void
}

type ServerStatusItem = {
  key: ServerConnection.Key
  conn: ServerConnection.Any
  health?: ServerHealth
  blocked: boolean
  active: boolean
  onSelect: () => void
}

export function StatusPopoverServerBody() {
  const global = useGlobal()
  const server = useServer()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const navigate = useNavigate()
  let dialogRun = 0
  let dialogDead = false
  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
  })

  const sortedServers = createMemo(() => listServersByHealth(global.servers.list(), server.key, global.servers.health))
  const defaultServer = useDefaultServerKey(platform.getDefaultServer)
  const serverItems = createMemo(() =>
    sortedServers().map((conn) => {
      const key = ServerConnection.key(conn)
      return {
        key,
        conn,
        health: global.servers.health[key],
        blocked: global.servers.health[key]?.healthy === false,
        active: !!server.current && key === ServerConnection.key(server.current),
        onSelect: () => {
          navigate("/")
          queueMicrotask(() => server.setActive(key))
        },
      }
    }),
  )

  return (
    <ServerStatusPopoverView
      state={{
        servers: serverItems,
        defaultKey: defaultServer.key,
        ariaLabel: language.t("status.popover.ariaLabel"),
        serversLabel: language.t("status.popover.tab.servers"),
        defaultLabel: language.t("common.default"),
        manageLabel: language.t("status.popover.action.manageServers"),
        onManage: () => {
          const run = ++dialogRun
          void import("./dialog-select-server").then((x) => {
            if (dialogDead || dialogRun !== run) return
            dialog.show(() => <x.DialogSelectServer />, defaultServer.refresh)
          })
        },
      }}
    />
  )
}

function ServerStatusPopoverView(props: { state: ServerStatusState }) {
  return (
    <section
      aria-label={props.state.ariaLabel}
      class={`flex w-[360px] max-w-full flex-col gap-0.5 ${popoverSurfaceClass}`}
    >
      <h2 class="px-3 pt-1.5 pb-1 text-[12px] text-v2-text-text-faint [font-weight:530]">
        {props.state.servers().length > 0 ? `${props.state.servers().length} ` : ""}
        {props.state.serversLabel}
      </h2>
      <For each={props.state.servers()}>
        {(item) => (
          <button
            type="button"
            class="flex min-h-11 w-full items-center gap-2.5 rounded-[16px] py-1.5 pr-2.5 pl-3 text-left text-[13px] transition-[background-color,border-radius] duration-short ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus motion-reduce:transition-none"
            classList={{
              "hover:bg-v2-overlay-simple-overlay-hover active:rounded-[12px]": !item.blocked,
              "cursor-not-allowed": item.blocked,
              "bg-v2-background-bg-accent-container text-v2-text-text-on-accent-container": item.active,
            }}
            aria-disabled={item.blocked}
            aria-current={item.active ? "true" : undefined}
            onClick={() => {
              if (item.blocked) return
              item.onSelect()
            }}
          >
            <ServerHealthIndicator health={item.health} />
            <ServerRow
              conn={item.conn}
              dimmed={item.blocked}
              status={item.health}
              class="flex w-full min-w-0 items-center gap-2"
              nameClass="truncate [font-weight:530]"
              versionClass="truncate text-[12px] text-v2-text-text-faint"
              badge={
                <Show when={item.key === props.state.defaultKey()}>
                  <span class="inline-flex h-5 items-center rounded-full bg-v2-background-bg-layer-02 px-2 text-[11px] text-v2-text-text-muted [font-weight:560]">
                    {props.state.defaultLabel}
                  </span>
                </Show>
              }
            >
              <div class="flex-1" />
              <Show when={item.active}>
                <Icon name="check" class="shrink-0" />
              </Show>
            </ServerRow>
          </button>
        )}
      </For>
      <div class="flex justify-end px-1 pt-1.5 pb-0.5">
        <ButtonV2 variant="ghost" size="small" onClick={props.state.onManage}>
          {props.state.manageLabel}
        </ButtonV2>
      </div>
    </section>
  )
}

export function StatusPopoverBody(props: { shown: Accessor<boolean> }) {
  const sync = useSync()
  const language = useLanguage()
  const protocol = useServerProtocol()

  const fail = (err: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })
  }

  createEffect(() => {
    if (!props.shown()) return
  })

  const toggleMcp = useMcpToggle()
  const mcpNames = createMemo(() => Object.keys(sync().data.mcp ?? {}).sort((a, b) => a.localeCompare(b)))
  const mcpStatus = (name: string) => sync().data.mcp?.[name]?.status
  const mcpConnected = createMemo(() => mcpNames().filter((name) => mcpStatus(name) === "connected").length)
  const lspItems = createMemo(() => sync().data.lsp ?? [])
  const lspCount = createMemo(() => lspItems().length)
  const plugins = createMemo(() =>
    (sync().data.config.plugin ?? []).map((item) => (typeof item === "string" ? item : item[0])),
  )
  const pluginCount = createMemo(() => plugins().length)
  const pluginEmpty = createMemo(() => pluginEmptyMessage(language.t("dialog.plugins.empty"), "opencode.json"))
  const [view, setView] = createStore({ tab: "mcp" })
  const empty = "my-auto px-3 py-4 text-center text-[13px] text-v2-text-text-muted"
  const row = "flex min-h-11 w-full items-center gap-2.5 rounded-[16px] py-1.5 pr-2.5 pl-3 text-[13px]"

  return (
    <section
      aria-label={language.t("status.popover.ariaLabel")}
      class={`flex w-[360px] max-w-full flex-col gap-0.5 ${popoverSurfaceClass}`}
    >
      <div class="px-1.5 pt-1.5 pb-2">
        <SegmentedControlV2
          aria-label={language.t("status.popover.ariaLabel")}
          value={view.tab}
          onChange={(value) => value && setView("tab", value)}
        >
          <SegmentedControlItemV2 value="mcp">
            {mcpConnected() > 0 ? `${mcpConnected()} ` : ""}
            {language.t("status.popover.tab.mcp")}
          </SegmentedControlItemV2>
          <SegmentedControlItemV2 value="lsp">
            {lspCount() > 0 ? `${lspCount()} ` : ""}
            {language.t("status.popover.tab.lsp")}
          </SegmentedControlItemV2>
          <Show when={protocol() === "v1"}>
            <SegmentedControlItemV2 value="plugins">
              {pluginCount() > 0 ? `${pluginCount()} ` : ""}
              {language.t("status.popover.tab.plugins")}
            </SegmentedControlItemV2>
          </Show>
        </SegmentedControlV2>
      </div>

      <Show when={view.tab === "mcp"}>
        <Show when={mcpNames().length > 0} fallback={<div class={empty}>{language.t("dialog.mcp.empty")}</div>}>
          <For each={mcpNames()}>
            {(name) => {
              const status = () => mcpStatus(name)
              return (
                <Switch
                  size="small"
                  class={`${row} ${switchRowClass}`}
                  checked={status() === "connected"}
                  disabled={toggleMcp.isPending && toggleMcp.variables === name}
                  onChange={() => {
                    if (toggleMcp.isPending) return
                    toggleMcp.mutate(name)
                  }}
                >
                  <span class={`size-2 shrink-0 rounded-full ${statusDotClass(status())}`} />
                  <span class="flex min-w-0 flex-1 flex-col gap-px">
                    <span class="truncate [font-weight:530]">{name}</span>
                    <Show when={status() === "needs_auth"}>
                      <span class="truncate text-[12px] text-v2-text-text-faint">
                        {language.t("mcp.auth.clickToAuthenticate")}
                      </span>
                    </Show>
                    <Show when={status() === "failed"}>
                      <span class="truncate text-[12px] text-v2-text-text-critical">
                        {language.t("mcp.status.failed")}
                      </span>
                    </Show>
                  </span>
                </Switch>
              )
            }}
          </For>
        </Show>
      </Show>

      <Show when={view.tab === "lsp"}>
        <Show when={lspItems().length > 0} fallback={<div class={empty}>{language.t("dialog.lsp.empty")}</div>}>
          <For each={lspItems()}>
            {(item) => (
              <div class={row}>
                <span class={`size-2 shrink-0 rounded-full ${statusDotClass(item.status)}`} />
                <span class="truncate [font-weight:530]">{item.name || item.id}</span>
              </div>
            )}
          </For>
        </Show>
      </Show>

      <Show when={protocol() === "v1" && view.tab === "plugins"}>
        <Show when={plugins().length > 0} fallback={<div class={empty}>{pluginEmpty()}</div>}>
          <For each={plugins()}>
            {(plugin) => (
              <div class={row}>
                <span class={`size-2 shrink-0 rounded-full ${statusDotClass("connected")}`} />
                <span class="truncate [font-weight:530]">{plugin}</span>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </section>
  )
}
