export * as ConfigHarness from "./harness"

import { Schema } from "effect"
import { Harness } from "@opencode-ai/schema/harness"

export class Instance extends Schema.Class<Instance>("Config.Harness.Instance")({
  driver: Harness.DriverKind,
  name: Schema.String.pipe(Schema.optional),
  enabled: Schema.Boolean.pipe(Schema.optional),
  config: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
}) {}

export class Codex extends Schema.Class<Codex>("Config.Harness.Codex")({
  binaryPath: Schema.String.pipe(Schema.optional),
  homePath: Schema.String.pipe(Schema.optional),
  launchArgs: Schema.Array(Schema.String).pipe(Schema.optional),
  customModels: Schema.Array(Schema.String).pipe(Schema.optional),
}) {}
