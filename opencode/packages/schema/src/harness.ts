export * as Harness from "./harness"

import { Schema } from "effect"
import { optional } from "./schema"

const slug = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
)

// Keep the wire contract open so a newer build or local fork can persist a
// harness instance before this build knows how to execute it. Availability is
// decided by the runtime registry, not by schema decoding.
export const InstanceID = slug
  .pipe(Schema.brand("@opencode/Harness.InstanceID"))
  .annotate({ identifier: "Harness.InstanceID" })
export type InstanceID = typeof InstanceID.Type

export const DriverKind = slug.pipe(Schema.brand("@opencode/Harness.DriverKind")).annotate({
  identifier: "Harness.DriverKind",
})
export type DriverKind = typeof DriverKind.Type

export const ModelSelection = Schema.Struct({
  id: Schema.String,
  reasoningEffort: Schema.String.pipe(optional),
  serviceTier: Schema.String.pipe(optional),
}).annotate({ identifier: "Harness.ModelSelection" })
export interface ModelSelection extends Schema.Schema.Type<typeof ModelSelection> {}

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String.pipe(optional),
  reasoningEfforts: Schema.Array(Schema.String),
  serviceTiers: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.String.pipe(optional),
    }),
  ),
  defaultReasoningEffort: Schema.String.pipe(optional),
  defaultServiceTier: Schema.String.pipe(optional),
  isDefault: Schema.Boolean,
}).annotate({ identifier: "Harness.Model" })
export interface Model extends Schema.Schema.Type<typeof Model> {}

export const Instance = Schema.Struct({
  id: InstanceID,
  driver: DriverKind,
  name: Schema.String,
  status: Schema.Literals(["available", "unavailable"]),
  version: Schema.String.pipe(optional),
  authenticated: Schema.Boolean.pipe(optional),
  error: Schema.String.pipe(optional),
  models: Schema.Array(Model),
}).annotate({ identifier: "Harness.Instance" })
export interface Instance extends Schema.Schema.Type<typeof Instance> {}

// A harness as Settings shows it. Only `registry` entries (harnesses.json) can be
// changed there; built-ins and config-file entries are read-only.
export const SettingsEntry = Schema.Struct({
  id: InstanceID,
  driver: DriverKind,
  name: Schema.String,
  enabled: Schema.Boolean,
  source: Schema.Literals(["built-in", "registry", "config"]),
  editable: Schema.Boolean,
  command: Schema.String.pipe(optional),
  args: Schema.Array(Schema.String).pipe(optional),
  models: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Harness.SettingsEntry" })
export interface SettingsEntry extends Schema.Schema.Type<typeof SettingsEntry> {}

export const Discovery = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  agentName: Schema.String.pipe(optional),
  version: Schema.String.pipe(optional),
  models: Schema.Array(Model),
}).annotate({ identifier: "Harness.Discovery" })
export interface Discovery extends Schema.Schema.Type<typeof Discovery> {}

export const SettingsInput = Schema.Struct({
  id: Schema.String,
  name: Schema.String.pipe(optional),
  command: Schema.String,
  args: Schema.Array(Schema.String).pipe(optional),
  models: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Harness.SettingsInput" })
export interface SettingsInput extends Schema.Schema.Type<typeof SettingsInput> {}

export const DiscoverInput = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Harness.DiscoverInput" })
export interface DiscoverInput extends Schema.Schema.Type<typeof DiscoverInput> {}

export const VerifyInput = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String).pipe(optional),
  model: Schema.String.pipe(optional),
}).annotate({ identifier: "Harness.VerifyInput" })
export interface VerifyInput extends Schema.Schema.Type<typeof VerifyInput> {}

// Result of a functional check: handshake, session, and one real reply.
export const Verification = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  agentName: Schema.String.pipe(optional),
  version: Schema.String.pipe(optional),
  models: Schema.Array(Model),
  reply: Schema.String,
  ok: Schema.Boolean,
}).annotate({ identifier: "Harness.Verification" })
export interface Verification extends Schema.Schema.Type<typeof Verification> {}

// Day-one setup state of a built-in external harness: whether its CLI is installed, and how it signs in.
// `auth` is read from the harness's own login files, so `unknown` means the app can't tell.
export const SetupStatus = Schema.Struct({
  id: InstanceID,
  name: Schema.String,
  packageName: Schema.String,
  installed: Schema.Boolean,
  version: Schema.String.pipe(optional),
  available: Schema.Boolean,
  error: Schema.String.pipe(optional),
  signIn: Schema.Literals(["link", "terminal"]),
  login: Schema.Array(Schema.String).pipe(optional),
  auth: Schema.Literals(["signed-in", "api-key", "signed-out", "unknown"]),
  apiKeys: Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String })),
  apiKey: Schema.String.pipe(optional),
}).annotate({ identifier: "Harness.SetupStatus" })
export interface SetupStatus extends Schema.Schema.Type<typeof SetupStatus> {}

export const SignIn = Schema.Struct({ url: Schema.String }).annotate({ identifier: "Harness.SignIn" })
export interface SignIn extends Schema.Schema.Type<typeof SignIn> {}

export const ApiKeyInput = Schema.Struct({
  option: Schema.String,
  key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
}).annotate({ identifier: "Harness.ApiKeyInput" })
export interface ApiKeyInput extends Schema.Schema.Type<typeof ApiKeyInput> {}

// Installed and latest version of a harness CLI. `method` is set only when the app can update it
// itself (a global npm or Bun package, or a Homebrew formula or cask).
export const UpdateStatus = Schema.Struct({
  id: InstanceID,
  name: Schema.String,
  version: Schema.String.pipe(optional),
  latest: Schema.String.pipe(optional),
  updateAvailable: Schema.Boolean,
  method: Schema.Literals(["npm", "bun", "brew"]).pipe(optional),
  error: Schema.String.pipe(optional),
}).annotate({ identifier: "Harness.UpdateStatus" })
export interface UpdateStatus extends Schema.Schema.Type<typeof UpdateStatus> {}

export const RefreshInput = Schema.Struct({
  id: Schema.String.pipe(optional),
}).annotate({ identifier: "Harness.RefreshInput" })
export interface RefreshInput extends Schema.Schema.Type<typeof RefreshInput> {}

// `opencode` is the stored ID of the in-process loop (shown as "Default agent"), kept so existing sessions keep
// routing there. Upstream OpenCode runs as an external ACP harness under `opencode-acp`, and Claude Code under
// `claude-code` through Anthropic's ACP adapter.
export const OpenCode = InstanceID.make("opencode")
export const OpenCodeAcp = InstanceID.make("opencode-acp")
export const ClaudeCode = InstanceID.make("claude-code")
export const Codex = InstanceID.make("codex")
export const OpenCodeDriver = DriverKind.make("opencode")
export const CodexDriver = DriverKind.make("codex")
export const AcpDriver = DriverKind.make("acp")
