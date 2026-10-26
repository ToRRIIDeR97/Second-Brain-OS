import { createContext, createEffect, createMemo, on, useContext, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { DesignSpaceProvider } from "@opencode-ai/session-ui/context/design"
import { collectDesigns, designFences, type Design, type DesignFence } from "@opencode-ai/session-ui/design-fence"
import { promptLength } from "@/components/prompt-input/history"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { CANVAS_TAB } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { appendPromptText } from "@/utils/prompt"

/**
 * The design space of a session: what the thread's ```html design windows do ("Use this one",
 * "Open in Canvas"), and the Canvas tab's state. Designs are read from the thread on demand;
 * only the inline designs a user pinned and the one shown large are kept, in memory.
 */
function createDesignCanvas() {
  const prompt = usePrompt()
  const command = useCommand()
  const language = useLanguage()
  const sync = useSync()
  const layout = useSessionLayout()
  const [store, setStore] = createStore({
    sessions: {} as Record<string, { pinned: Design[]; selected?: string }>,
  })
  // Canvas blocks (session:design) that already opened the panel once after streaming.
  const revealed = new Set<string>()
  const sessionID = () => layout.params.id
  const current = () => store.sessions[sessionID() ?? ""]

  const show = (design: Design) => {
    const id = sessionID()
    if (!id) return
    setStore("sessions", id, (state) => ({
      pinned:
        design.canvas || state?.pinned.some((item) => item.id === design.id)
          ? (state?.pinned ?? [])
          : [...(state?.pinned ?? []), design],
      selected: design.id,
    }))
    const view = layout.view()
    const tabs = layout.tabs()
    view.reviewPanel.open(view.reviewPanel.opened() ? "other" : "context-button")
    // Appended directly so opening the canvas never replaces a file preview tab.
    if (!tabs.all().includes(CANVAS_TAB)) tabs.setAll([...tabs.all(), CANVAS_TAB])
    tabs.setActive(CANVAS_TAB)
  }

  return {
    sessionID,
    selected: () => current()?.selected,
    select: (designID: string | undefined) => {
      const id = sessionID()
      if (!id) return
      setStore("sessions", id, (state) => ({ pinned: state?.pinned ?? [], selected: designID }))
    },
    /** Every canvas design of the current thread plus pinned inline ones; call inside a memo. */
    designs: createDesignList(sync, sessionID, () => current()?.pinned ?? []),
    use: (design: Design) => {
      const title = design.title ?? language.t("secondBrain.canvas.untitled")
      const next = appendPromptText(prompt.current(), language.t("secondBrain.canvas.useReference", { title }))
      prompt.set(next, promptLength(next))
      command.trigger("input.focus")
    },
    open: show,
    reveal: (design: Design) => {
      const key = `${sessionID()}:${design.id}`
      if (revealed.has(key)) return
      revealed.add(key)
      show(design)
    },
  }
}

function createDesignList(
  sync: ReturnType<typeof useSync>,
  sessionID: () => string | undefined,
  pinned: () => Design[],
) {
  // Fence parsing per part, so a streaming reply only rescans the part that changed.
  const scanned = new Map<string, { text: string; fences: DesignFence[] }>()
  const scan = (part: { id: string; text: string }) => {
    const cached = scanned.get(part.id)
    if (cached?.text === part.text) return cached.fences
    const fences = designFences(part.text)
    scanned.set(part.id, { text: part.text, fences })
    return fences
  }
  createEffect(on(sessionID, () => scanned.clear(), { defer: true }))
  return () => {
    const id = sessionID()
    if (!id) return []
    const keep = pinned()
    const found = collectDesigns(
      sync().data.message[id] ?? [],
      sync().data.part,
      keep.map((design) => design.id),
      scan,
    )
    const ids = new Set(found.map((design) => design.id))
    return [...found, ...keep.filter((design) => !ids.has(design.id))]
  }
}

const Context = createContext<ReturnType<typeof createDesignCanvas>>()

export function DesignCanvasProvider(props: ParentProps) {
  const canvas = createDesignCanvas()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  // The Canvas tab lives in the desktop side panel of a saved session.
  const panel = createMemo(() => isDesktop() && !!canvas.sessionID())
  return (
    <Context.Provider value={canvas}>
      <DesignSpaceProvider
        use={canvas.use}
        open={panel() ? canvas.open : undefined}
        reveal={panel() ? canvas.reveal : undefined}
      >
        {props.children}
      </DesignSpaceProvider>
    </Context.Provider>
  )
}

export function useDesignCanvas() {
  const value = useContext(Context)
  if (!value) throw new Error("DesignCanvas context must be used within a context provider")
  return value
}
