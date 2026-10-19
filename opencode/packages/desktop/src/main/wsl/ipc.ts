import { app } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import type { WslServersController } from "./servers"
import { requireWslDistro, requireWslIpcString, validWslDistros } from "./policy"
import type { WslServersState } from "../../preload/types"
import { trustedHandle } from "../ipc"
import { nativeT } from "../native-translations"

export function registerWslIpcHandlers(controller: WslServersController) {
  if (process.platform !== "win32") {
    registerUnavailableWslIpcHandlers()
    return
  }

  const subscriptions = new Map<number, () => void>()
  const unsubscribe = (id: number) => {
    const off = subscriptions.get(id)
    if (!off) return
    off()
    subscriptions.delete(id)
  }

  app.once("will-quit", () => {
    subscriptions.forEach((off) => off())
    subscriptions.clear()
  })

  trustedHandle("wsl-servers-subscribe", (event) => {
    const id = event.sender.id
    if (subscriptions.has(id)) return
    subscriptions.set(
      id,
      controller.subscribe((payload) => {
        if (event.sender.isDestroyed()) {
          unsubscribe(id)
          return
        }
        event.sender.send("wsl-servers-event", payload)
      }),
    )
    event.sender.once("destroyed", () => unsubscribe(id))
  })
  trustedHandle("wsl-servers-unsubscribe", (event) => unsubscribe(event.sender.id))
  trustedHandle("wsl-servers-get-state", () => controller.getState())
  trustedHandle("wsl-servers-probe-runtime", () => controller.probeRuntime())
  trustedHandle("wsl-servers-refresh-distros", () => controller.refreshDistros())
  trustedHandle("wsl-servers-install-wsl", () => controller.installWsl())
  trustedHandle("wsl-servers-install-distro", (_event: IpcMainInvokeEvent, name: unknown) =>
    controller.installDistro(requireWslDistro(name)),
  )
  trustedHandle("wsl-servers-probe-addable", (_event: IpcMainInvokeEvent, distros: unknown) =>
    controller.probeAddable(validWslDistros(distros)),
  )
  trustedHandle("wsl-servers-open-terminal", (_event: IpcMainInvokeEvent, name: unknown) =>
    controller.openTerminal(requireWslDistro(name)),
  )
  trustedHandle("wsl-servers-add", (_event: IpcMainInvokeEvent, distro: unknown) =>
    controller.addServer(requireWslDistro(distro)),
  )
  trustedHandle("wsl-servers-remove", (_event: IpcMainInvokeEvent, id: unknown) =>
    controller.removeServer(requireWslIpcString("server id", id)),
  )
  trustedHandle("wsl-servers-start", (_event: IpcMainInvokeEvent, id: unknown) =>
    controller.startServer(requireWslIpcString("server id", id)),
  )
}

function registerUnavailableWslIpcHandlers() {
  const unavailable = () => {
    throw new Error(nativeT("desktop.wsl.error.windowsOnly"))
  }
  const state = (): WslServersState => ({
    runtime: {
      available: false,
      version: null,
      error: nativeT("desktop.wsl.error.windowsOnly"),
    },
    installed: [],
    online: [],
    distroProbes: {},
    opencodeChecks: {},
    pendingRestart: false,
    servers: [],
    job: null,
  })

  trustedHandle("wsl-servers-subscribe", (event) => {
    event.sender.send("wsl-servers-event", { type: "state", state: state() })
  })
  trustedHandle("wsl-servers-unsubscribe", () => undefined)
  trustedHandle("wsl-servers-get-state", () => state())
  trustedHandle("wsl-servers-probe-runtime", unavailable)
  trustedHandle("wsl-servers-refresh-distros", unavailable)
  trustedHandle("wsl-servers-install-wsl", unavailable)
  trustedHandle("wsl-servers-install-distro", unavailable)
  trustedHandle("wsl-servers-probe-addable", unavailable)
  trustedHandle("wsl-servers-open-terminal", unavailable)
  trustedHandle("wsl-servers-add", unavailable)
  trustedHandle("wsl-servers-remove", unavailable)
  trustedHandle("wsl-servers-start", unavailable)
}
