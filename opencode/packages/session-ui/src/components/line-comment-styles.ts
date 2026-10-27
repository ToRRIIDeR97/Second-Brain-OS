export const lineCommentStyles = `
[data-annotation-slot] {
  padding: 12px;
  box-sizing: border-box;
}

[data-component="line-comment"] {
  position: absolute;
  right: 24px;
  z-index: var(--line-comment-z, 30);
}

[data-component="line-comment"][data-inline] {
  position: relative;
  right: auto;
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: flex-start;
}

[data-component="line-comment"][data-open] {
  z-index: var(--line-comment-open-z, 100);
}

[data-component="line-comment"] [data-slot="line-comment-button"] {
  width: 20px;
  height: 20px;
  border-radius: var(--v2-radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--v2-background-bg-accent);
  box-shadow: var(--v2-elevation-elements);
  cursor: default;
  border: none;
}

[data-component="line-comment"][data-variant="add"] [data-slot="line-comment-button"] {
  background: var(--syntax-diff-add);
}

[data-component="line-comment"] [data-component="icon"] {
  color: var(--v2-text-text-contrast);
}

[data-component="line-comment"] [data-slot="line-comment-icon"] {
  width: 12px;
  height: 12px;
  color: var(--v2-text-text-contrast);
}

[data-component="line-comment"] [data-slot="line-comment-button"]:focus {
  outline: none;
}

[data-component="line-comment"] [data-slot="line-comment-button"]:focus-visible {
  box-shadow: 0 0 0 2px var(--v2-border-border-focus);
}

[data-component="line-comment"] [data-slot="line-comment-popover"] {
  position: absolute;
  top: calc(100% + 4px);
  right: -8px;
  z-index: var(--line-comment-popover-z, 40);
  min-width: 200px;
  max-width: none;
  box-sizing: border-box;
  border-radius: var(--v2-radius-lg);
  background: var(--v2-background-bg-base);
  box-shadow: var(--v2-elevation-floating);
  padding: 12px;
}

[data-component="line-comment"][data-inline] [data-slot="line-comment-popover"] {
  position: relative;
  top: auto;
  right: auto;
  margin-left: 8px;
  flex: 1 1 0%;
  width: auto;
  max-width: 100%;
  min-width: 0;
}

[data-component="line-comment"][data-inline] [data-slot="line-comment-popover"][data-inline-body] {
  margin-left: 0;
}

[data-component="line-comment"][data-inline][data-variant="default"] [data-slot="line-comment-popover"][data-inline-body] {
  cursor: pointer;
}

[data-component="line-comment"][data-variant="editor"] [data-slot="line-comment-popover"] {
  width: 380px;
  max-width: none;
  padding: 8px;
  border-radius: var(--v2-radius-lg);
}

[data-component="line-comment"][data-inline][data-variant="editor"] [data-slot="line-comment-popover"] {
  width: 100%;
}

[data-component="line-comment"] [data-slot="line-comment-content"] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

[data-component="line-comment"] [data-slot="line-comment-head"] {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

[data-component="line-comment"] [data-slot="line-comment-text"] {
  flex: 1;
  min-width: 0;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-regular);
  line-height: var(--line-height-x-large);
  letter-spacing: var(--letter-spacing-normal);
  color: var(--v2-text-text-base);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

[data-component="line-comment"] [data-slot="line-comment-tools"] {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
}

[data-component="line-comment"] [data-slot="line-comment-label"],
[data-component="line-comment"] [data-slot="line-comment-editor-label"] {
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-large);
  letter-spacing: var(--letter-spacing-normal);
  color: var(--v2-text-text-muted);
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

[data-component="line-comment"] [data-slot="line-comment-editor"] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

[data-component="line-comment"] [data-slot="line-comment-textarea"] {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 8px;
  border-radius: var(--v2-radius-md);
  background: var(--v2-background-bg-layer-01);
  border: none;
  color: var(--v2-text-text-base);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  line-height: var(--line-height-large);
}

[data-component="line-comment"] [data-slot="line-comment-textarea"]:focus {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--v2-border-border-focus);
}

[data-component="line-comment"] [data-slot="line-comment-mention-list"] {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow: auto;
  padding: 4px;
  border: none;
  border-radius: var(--v2-radius-md);
  background: var(--v2-background-bg-layer-01);
}

[data-component="line-comment"] [data-slot="line-comment-mention-item"] {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--v2-radius-full);
  background: transparent;
  color: var(--v2-text-text-base);
  text-align: left;
}

[data-component="line-comment"] [data-slot="line-comment-mention-item"][data-active] {
  background: var(--v2-overlay-simple-overlay-hover);
}

[data-component="line-comment"] [data-slot="line-comment-mention-path"] {
  display: flex;
  align-items: center;
  min-width: 0;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  line-height: var(--line-height-large);
}

[data-component="line-comment"] [data-slot="line-comment-mention-dir"] {
  min-width: 0;
  color: var(--v2-text-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

[data-component="line-comment"] [data-slot="line-comment-mention-file"] {
  color: var(--v2-text-text-base);
  white-space: nowrap;
}

[data-component="line-comment"] [data-slot="line-comment-actions"] {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-left: 8px;
  min-width: 0;
}

[data-component="line-comment"] [data-slot="line-comment-editor-label"] {
  flex: 1 1 220px;
  margin-right: auto;
}

[data-component="line-comment"] [data-slot="line-comment-action"] {
  border: none;
  background: var(--v2-background-bg-layer-02);
  color: var(--v2-text-text-base);
  border-radius: var(--v2-radius-full);
  height: 28px;
  padding: 0 10px;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-weight: var(--font-weight-medium);
}

[data-component="line-comment"] [data-slot="line-comment-action"][data-variant="ghost"] {
  background: transparent;
}

[data-component="line-comment"] [data-slot="line-comment-action"][data-variant="primary"] {
  background: var(--v2-background-bg-accent);
  color: var(--v2-text-text-contrast);
}

[data-component="line-comment"] [data-slot="line-comment-action"]:disabled {
  opacity: 0.5;
  pointer-events: none;
}

/* The comment editor and a popover opened from a comment button fade and rise in (medium +
   emphasized-decelerate); saved comments shown inline with the file appear as they are. */
[data-component="line-comment"][data-variant="editor"] [data-slot="line-comment-popover"],
[data-component="line-comment"] [data-slot="line-comment-popover"]:not([data-inline-body]) {
  animation: line-comment-enter var(--v2-duration-medium) var(--v2-ease-emphasized-decelerate) both;
}

@keyframes line-comment-enter {
  from {
    opacity: 0;
    translate: 0 4px;
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-component="line-comment"] [data-slot="line-comment-popover"] {
    animation: none !important;
  }
}
`

let installed = false

export function installLineCommentStyles() {
  if (installed) return
  if (typeof document === "undefined") return

  const id = "opencode-line-comment-styles"
  if (document.getElementById(id)) {
    installed = true
    return
  }

  const style = document.createElement("style")
  style.id = id
  style.textContent = lineCommentStyles
  document.head.appendChild(style)
  installed = true
}
