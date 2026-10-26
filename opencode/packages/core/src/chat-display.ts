export * as ChatDisplay from "./chat-display"

/** Tells agents that Tenon's chat renders ```svg fenced blocks as diagram windows (session-ui svg-window.ts). */
export const svgGuidance = [
  "Tenon Workbench chat renders a fenced code block tagged `svg` as an inline diagram window.",
  "When a diagram, graph, or codebase map would explain something better than text, write one complete <svg> element with a viewBox inside a ```svg block.",
  "The window is sandboxed: scripts, event handlers, links and external resources (images, fonts, stylesheets) are removed or blocked, so keep the SVG self-contained.",
  "For colors that read in light and dark themes, use currentColor or the CSS variables --tenon-fg, --tenon-muted, --tenon-accent, --tenon-surface and --tenon-border.",
  "Keep text at 12px or larger and the viewBox width near 680.",
].join("\n")

/**
 * How an agent asks the user a question. External harnesses reach Tenon through the `ask_user`
 * tool of the `tenon` MCP server; native agents have the built-in `question` tool.
 */
export const askGuidance = {
  harness:
    "When you are unsure and the choice matters, ask the user instead of guessing: call the `ask_user` tool on the `tenon` MCP server.",
  native: "When you are unsure and the choice matters, ask the user instead of guessing: use the `question` tool.",
} as const

/** Inline ```html previews and ```html canvas artboards (the right panel's Canvas tab). */
export const designGuidance = [
  "For a small visual (one component or a few variants), write one self-contained ```html fenced block. Inline CSS and JavaScript are fine; no network requests or external resources. It renders inline in a sandboxed window.",
  'For larger design work (whole pages or several screens), write one ```html canvas title="Name" block per artboard. Artboards appear in the Canvas tab of the right panel.',
  "Diagrams stay ```svg blocks.",
].join("\n")

/** File references the chat turns into links. */
export const fileReferenceGuidance =
  "Cite files as inline code with a path relative to the thread folder, optionally with a line or range, like `src/app.tsx:42` or `src/app.tsx:42-58`. These become clickable in the chat."

/** All Tenon chat abilities for one kind of agent, kept short because harnesses receive it at every handoff. */
export function abilities(agent: keyof typeof askGuidance) {
  return [askGuidance[agent], designGuidance, svgGuidance, fileReferenceGuidance].join("\n\n")
}
