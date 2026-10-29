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

const TitleAgent = Schema.Struct({ id: Schema.optional(Harness.InstanceID) })

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
    HttpApiEndpoint.get("harness.titleAgent", "/api/harness/title-agent", {
      query: LocationQuery,
      success: Location.response(TitleAgent),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.titleAgent",
          "Get title agent",
          "The harness that titles new threads. Without one, each thread is titled by its own harness.",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.put("harness.setTitleAgent", "/api/harness/title-agent", {
      query: LocationQuery,
      payload: TitleAgent,
      success: Location.response(TitleAgent),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.setTitleAgent",
          "Set title agent",
          "Choose the harness that titles new threads, or omit id to title each thread with its own harness.",
        ),
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
  .add(
    HttpApiEndpoint.post("harness.refresh", "/api/harness/refresh", {
      query: LocationQuery,
      payload: Harness.RefreshInput,
      success: Location.response(Schema.Array(Harness.Instance)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.refresh",
          "Refresh harnesses",
          "Drop cached availability checks and model lists, for one harness or all, and list again.",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.get("harness.updates", "/api/harness/updates", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Harness.UpdateStatus)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.updates",
          "Check harness updates",
          "Compare each harness CLI's installed version with the latest release from its package manager.",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.get("harness.usage", "/api/harness/usage", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Harness.UsageReport)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.usage",
          "Harness usage limits",
          "Subscription usage windows of each enabled external harness, cached per harness for a minute.",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.post("harness.upgrade", "/api/harness/upgrade/:id", {
      params: { id: Schema.String },
      query: LocationQuery,
      success: Location.response(Harness.UpdateStatus),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.upgrade",
          "Update harness CLI",
          "Update a harness CLI with the package manager that installed it and restart its processes.",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.get("harness.setup", "/api/harness/setup", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Harness.SetupStatus)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.setup",
          "List harness setup",
          "Install and sign-in state of the built-in external harnesses (Codex, Claude Code, OpenCode).",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.post("harness.install", "/api/harness/setup/:id/install", {
      params: { id: Schema.String },
      query: LocationQuery,
      success: Location.response(Harness.SetupStatus),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.install",
          "Install harness",
          "Install a built-in harness CLI globally with npm, from the package the server knows for it.",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.post("harness.signIn", "/api/harness/setup/:id/sign-in", {
      params: { id: Schema.String },
      query: LocationQuery,
      success: Location.response(Harness.SignIn),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.signIn",
          "Start harness sign-in",
          "Start a browser sign-in for a harness that supports one and return the link to open.",
        ),
      ),
  )
  .add(
    HttpApiEndpoint.put("harness.setKey", "/api/harness/setup/:id/api-key", {
      params: { id: Schema.String },
      query: LocationQuery,
      payload: Harness.ApiKeyInput,
      success: Location.response(Harness.SetupStatus),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(annotate("v2.harness.setKey", "Set harness API key", "Save the API key a built-in harness uses.")),
  )
  .add(
    HttpApiEndpoint.delete("harness.removeKey", "/api/harness/setup/:id/api-key", {
      params: { id: Schema.String },
      query: LocationQuery,
      success: Location.response(Harness.SetupStatus),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        annotate(
          "v2.harness.removeKey",
          "Remove harness API key",
          "Remove the API key a built-in harness uses, or sign Codex out.",
        ),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "harnesses",
      description: "Harness availability, model discovery, and harness settings routes.",
    }),
  )
