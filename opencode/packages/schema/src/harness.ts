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

export const OpenCode = InstanceID.make("opencode")
export const Codex = InstanceID.make("codex")
export const OpenCodeDriver = DriverKind.make("opencode")
export const CodexDriver = DriverKind.make("codex")
