import { useEffect, useRef, useState, type RefObject } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { renderSafeMath } from "./math";

export type MathNodeViewProps = ReactNodeViewProps & {
  displayMode?: boolean;
};

function valueFromNode(node: MathNodeViewProps["node"]): string {
  return typeof node.attrs.value === "string" ? node.attrs.value : "";
}

export function MathNodeView({
  node,
  updateAttributes,
  displayMode = false,
}: MathNodeViewProps) {
  const value = valueFromNode(node);
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    if (draft !== value) updateAttributes({ value: draft });
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const beginEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const wrapperTag = displayMode ? "div" : "span";
  const label = displayMode ? "Edit display math TeX" : "Edit inline math TeX";

  return (
    <NodeViewWrapper
      as={wrapperTag}
      contentEditable={false}
      data-math-editor="true"
      data-math-mode={displayMode ? "block" : "inline"}
    >
      {editing ? (
        <span className="math-editor-input" role="group" aria-label={label}>
          {displayMode ? (
            <textarea
              ref={inputRef as RefObject<HTMLTextAreaElement>}
              aria-label="Math TeX"
              value={draft}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
              }}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                } else if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault();
                  commit();
                }
              }}
            />
          ) : (
            <input
              ref={inputRef as RefObject<HTMLInputElement>}
              aria-label="Math TeX"
              value={draft}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
              }}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
              }}
            />
          )}
          <button
            type="button"
            aria-label="Save math TeX"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={commit}
          >
            Save
          </button>
          <button
            type="button"
            aria-label="Cancel math edit"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={cancel}
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="math-rendered"
          aria-label={label}
          onClick={beginEdit}
          onFocus={beginEdit}
        >
          <span
            aria-hidden="true"
            dangerouslySetInnerHTML={{
              __html: renderSafeMath(value, displayMode),
            }}
          />
        </button>
      )}
    </NodeViewWrapper>
  );
}
