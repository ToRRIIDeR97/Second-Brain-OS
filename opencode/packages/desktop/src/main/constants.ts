export type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// Enable only after Second Brain has a signed, verified release feed.
export const UPDATER_ENABLED = false

// Own URL scheme; `opencode://` belongs to upstream OpenCode Desktop. Must match the renderer's
// parser in packages/app/src/pages/layout/deep-links.ts and the electron-builder protocols entry.
export const DEEP_LINK_SCHEME = "tenon"
