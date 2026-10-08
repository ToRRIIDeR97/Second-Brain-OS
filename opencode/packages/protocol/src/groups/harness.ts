import { Harness } from "@opencode-ai/schema/harness"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

const errorFields = { reason: Schema.String, message: Schema.String }

// Each status gets its own error so the reason stays machine-readable for the Settings page.
export class HarnessSettingsInvalidError extends Schema.TaggedErrorClass<HarnessSettingsInvalidError>()(
  "HarnessSettingsInvalidError",
  errorFields,
  { httpApiStatus: 400 },
) {}

export class HarnessSettingsNotFoundError extends Schema.TaggedErrorClass<HarnessSettingsNotFoundError>()(
  "HarnessSettingsNotFoundError",
  errorFields,
  { httpApiStatus: 404 },
) {}

export class HarnessSettingsExistsError extends Schema.TaggedErrorClass<HarnessSettingsExistsError>()(
  "HarnessSettingsExistsError",
  errorFields,
  { httpApiStatus: 409 },
) {}

export class HarnessSettingsWriteError extends Schema.TaggedErrorClass<HarnessSettingsWriteError>()(
  "HarnessSettingsWriteError",
  errorFields,
  { httpApiStatus: 500 },
) {}

const errors = [
  HarnessSettingsInvalidError,
  HarnessSettingsNotFoundError,
  HarnessSettingsExistsError,
  HarnessSettingsWriteError,
]

const annotate = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({ identifier, summary, description })

export const HarnessGroup = HttpApiGroup.make("server.harness")
  .add(
    HttpApiEndpoint.get("harness.list", "/api/harness", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Harness.Instance)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.harness.list",
          summary: "List harnesses",
          description: "Probe configured harness instances and list their available models.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("harness.settings", "/api/harness/settings", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Harness.SettingsEntry)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate("v2.harness.settings", "List harness settings", "List harnesses with their source and editability."),
      ),
  )
  .add(
    HttpApiEndpoint.post("harness.discover", "/api/harness/discover", {
      query: LocationQuery,
      payload: Harness.DiscoverInput,
      success: Location.response(Harness.Discovery),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.discover",
          "Test an ACP command",
          "Run the ACP handshake for a command and list the agent's models without saving it.",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.get("harness.assistantDirectory", "/api/harness/assistant-directory", {
      query: LocationQuery,
      success: Location.response(Schema.Struct({ directory: Schema.String })),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.assistantDirectory",
          "Setup assistant folder",
          "Return the folder where harness setup-assistant sessions run.",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.post("harness.verify", "/api/harness/verify", {
      query: LocationQuery,
      payload: Harness.VerifyInput,
      success: Location.response(Harness.Verification),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.verify",
          "Run a functional test",
          "Open a session with an ACP command and send one short prompt to check that it answers.",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.post("harness.add", "/api/harness/registry", {
      query: LocationQuery,
      payload: Harness.SettingsInput,
      success: Location.response(Harness.SettingsEntry),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(annotate("v2.harness.add", "Add harness", "Check an ACP command and save it to harnesses.json.")),
  )
  .add(
    HttpApiEndpoint.patch("harness.update", "/api/harness/registry/:id", {
      params: { id: Schema.String },
      query: LocationQuery,
      payload: Schema.Struct({ enabled: Schema.Boolean }),
      success: Location.response(Harness.SettingsEntry),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(annotate("v2.harness.update", "Enable or disable harness", "Enable or disable a saved harness.")),
  )
  .add(
    HttpApiEndpoint.delete("harness.remove", "/api/harness/registry/:id", {
      params: { id: Schema.String },
      query: LocationQuery,
      success: Location.response(Schema.Struct({ id: Schema.String })),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(annotate("v2.harness.remove", "Remove harness", "Remove a saved harness from harnesses.json.")),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "harnesses",
      description: "Harness availability, model discovery, and harness settings routes.",
    }),
  )
