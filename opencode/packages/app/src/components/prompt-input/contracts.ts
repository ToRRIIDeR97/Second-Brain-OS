import type { useLocal } from "@/context/local"
import type { usePrompt } from "@/context/prompt"
import type { PromptInputHistory } from "./history-store"
import type { PromptSubmitOptions } from "./submit"
import type { Harness } from "@opencode-ai/schema/harness"

export type PromptInputState = ReturnType<typeof usePrompt>

export type PromptInputSubmission = {
  abort: () => Promise<void> | void
  handleSubmit: (event: Event, options?: PromptSubmitOptions) => Promise<void> | void
}

export type PromptInputControls = {
  agents: {
    available: { name: string; hidden?: boolean; mode: string }[]
    options: string[]
    current: string
    loading: boolean
    visible: boolean
    select: (name: string | undefined) => void
  }
  model: {
    selection: ReturnType<typeof useLocal>["model"]
    paid: boolean
    loading: boolean
  }
  session: {
    id?: string
    tabs: {
      active: () => string | undefined
      all: () => string[]
      open: (tab: string) => void | Promise<void>
      setActive: (tab: string) => void
    }
    reviewPanel: {
      opened: () => boolean
      open: () => void
    }
  }
}

export interface PromptInputProps {
  class?: string
  state?: PromptInputState
  history?: PromptInputHistory
  submission?: PromptInputSubmission
  controls: PromptInputControls
  ref?: (el: HTMLDivElement) => void
  newSessionWorktree?: string
  newSessionHarness?: Harness.InstanceID
  newSessionHarnessModel?: Harness.ModelSelection
  harnessDriver?: Harness.DriverKind
  harnessChanging?: boolean
  onNewSessionWorktreeReset?: () => void
  onAbort?: () => void
  onSubmit?: () => void
}
