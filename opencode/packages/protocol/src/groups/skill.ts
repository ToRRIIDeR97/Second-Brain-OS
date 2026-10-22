import { Skill } from "@opencode-ai/schema/skill"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

const errorFields = { reason: Schema.String, message: Schema.String }

export class SkillNotFoundError extends Schema.TaggedErrorClass<SkillNotFoundError>()(
  "SkillNotFoundError",
  errorFields,
  { httpApiStatus: 404 },
) {}

export class SkillToggleWriteError extends Schema.TaggedErrorClass<SkillToggleWriteError>()(
  "SkillToggleWriteError",
  errorFields,
  { httpApiStatus: 500 },
) {}

export const SkillGroup = HttpApiGroup.make("server.skill")
  .add(
    HttpApiEndpoint.get("skill.list", "/api/skill", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.list",
          summary: "List skills",
          description: "Retrieve currently registered skills.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("skill.catalog", "/api/skill/catalog", {
      query: LocationQuery,
      success: Location.response(Skill.Catalog),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.catalog",
          summary: "List skills by harness",
          description:
            "Tenon skills, then the skills each external harness can use, read-only. Names, descriptions and paths only.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("skill.setEnabled", "/api/skill/enabled", {
      query: LocationQuery,
      payload: Schema.Struct({ name: Schema.String, enabled: Schema.Boolean }),
      success: Location.response(Schema.Struct({ name: Schema.String, enabled: Schema.Boolean })),
      error: [SkillNotFoundError, SkillToggleWriteError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.setEnabled",
          summary: "Switch a Tenon skill on or off",
          description:
            "Saves the choice in skills.json in the Tenon config directory. Harness skills can't be switched.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "skills",
      description: "Experimental skill routes.",
    }),
  )
