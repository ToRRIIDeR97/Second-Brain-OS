import { useMemo, useState } from "react";
import { ModalDialog } from "../../../components/common/ModalDialog";

function noteSlug(title: string) {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "untitled"
  );
}

export function NewNoteDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (relativePath: string, title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const relativePath = useMemo(() => `notes/${noteSlug(title)}.md`, [title]);

  return (
    <ModalDialog
      open={open}
      title="Create a new note"
      eyebrow="Quick capture"
      onClose={onClose}
    >
      <form
        className="new-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = title.trim();
          if (!value) return;
          onCreate(relativePath, value);
          setTitle("");
          onClose();
        }}
      >
        <label>
          Note title
          <input
            required
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            placeholder="Architecture decision"
            autoComplete="off"
          />
        </label>
        <p className="path-preview">
          <span>Location</span>
          <code>{relativePath}</code>
        </p>
        <footer className="modal-dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={!title.trim()}
          >
            Create note
          </button>
        </footer>
      </form>
    </ModalDialog>
  );
}
