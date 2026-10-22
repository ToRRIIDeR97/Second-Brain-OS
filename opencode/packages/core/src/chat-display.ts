export * as ChatDisplay from "./chat-display"

/** Tells agents that Tenon's chat renders ```svg fenced blocks as diagram windows (session-ui svg-window.ts). */
export const svgGuidance = [
  "Tenon Workbench chat renders a fenced code block tagged `svg` as an inline diagram window.",
  "When a diagram, graph, or codebase map would explain something better than text, write one complete <svg> element with a viewBox inside a ```svg block.",
  "The window is sandboxed: scripts, event handlers, links and external resources (images, fonts, stylesheets) are removed or blocked, so keep the SVG self-contained.",
  "For colors that read in light and dark themes, use currentColor or the CSS variables --tenon-fg, --tenon-muted, --tenon-accent, --tenon-surface and --tenon-border.",
  "Keep text at 12px or larger and the viewBox width near 680.",
].join("\n")
