import { Harness } from "@opencode-ai/schema/harness"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

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
  .annotateMerge(
    OpenApi.annotations({
      title: "harnesses",
      description: "Harness instance availability and model discovery routes.",
    }),
  )
