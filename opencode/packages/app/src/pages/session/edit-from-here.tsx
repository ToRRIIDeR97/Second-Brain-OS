import { For, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"

type DiffApi = (input: { sessionID: string; messageID: string }) => Promise<ReadonlyArray<{ file: string }>>

/**
 * Files an "Edit from here" with files would restore: every file changed by the turns
 * from `messageID` onward, using the per-turn `GET /api/session/:id/diff`.
 */
export async function editFromHereFiles(input: {
  diff: DiffApi
  sessionID: string
  messageID: string
  userMessageIDs: readonly string[]
}) {
  const start = input.userMessageIDs.indexOf(input.messageID)
  const turns = start < 0 ? [input.messageID] : input.userMessageIDs.slice(start)
  const diffs = await Promise.all(turns.map((messageID) => input.diff({ sessionID: input.sessionID, messageID })))
  return Array.from(new Set(diffs.flatMap((files) => files.map((item) => item.file)))).sort()
}

/** Resolves true when the user confirms restoring `files` (undefined: the list could not be loaded). */
export function confirmEditFromHere(dialog: ReturnType<typeof useDialog>, files: string[] | undefined) {
  return new Promise<boolean>((resolve) => {
    let confirmed = false
    dialog.show(
      () => (
        <EditFromHereDialog
          files={files}
          onCancel={() => dialog.close()}
          onConfirm={() => {
            confirmed = true
            dialog.close()
          }}
        />
      ),
      () => resolve(confirmed),
    )
  })
}

function EditFromHereDialog(props: { files: string[] | undefined; onCancel: () => void; onConfirm: () => void }) {
  const language = useLanguage()
  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("secondBrain.editFromHere.title")}
          description={language.t("secondBrain.editFromHere.description")}
        />
      </DialogHeader>
      <DialogBody class="px-4">
        <Show
          when={props.files}
          fallback={
            <p class="text-[13px] leading-5 text-v2-text-text-muted">
              {language.t("secondBrain.editFromHere.unavailable")}
            </p>
          }
        >
          {(files) => (
            <ul class="flex max-h-60 flex-col gap-0.5 overflow-y-auto rounded-[16px] bg-v2-background-bg-layer-02 px-3.5 py-2.5 font-mono text-[12px] leading-5 text-v2-text-text-base">
              <For each={files()}>{(file) => <li class="truncate">{file}</li>}</For>
            </ul>
          )}
        </Show>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 type="button" variant="ghost" size="large" onClick={props.onCancel}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 type="button" variant="contrast" size="large" onClick={props.onConfirm}>
          {language.t("secondBrain.editFromHere.confirm")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
