import { For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
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
    <Dialog
      title={language.t("secondBrain.editFromHere.title")}
      description={language.t("secondBrain.editFromHere.description")}
      class="w-full max-w-[480px] mx-auto"
    >
      <div class="flex flex-col gap-6 p-6 pt-0">
        <Show
          when={props.files}
          fallback={<p class="text-14-regular text-text-weak">{language.t("secondBrain.editFromHere.unavailable")}</p>}
        >
          {(files) => (
            <ul class="flex flex-col gap-1 max-h-60 overflow-y-auto text-13-regular font-mono text-text-base">
              <For each={files()}>{(file) => <li class="truncate">{file}</li>}</For>
            </ul>
          )}
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={props.onCancel}>
            {language.t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" size="large" onClick={props.onConfirm}>
            {language.t("secondBrain.editFromHere.confirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
