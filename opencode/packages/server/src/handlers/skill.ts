import { HarnessSkills } from "@opencode-ai/core/harness/skills"
import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillNotFoundError, SkillToggleWriteError } from "@opencode-ai/protocol/groups/skill"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const SkillHandler = HttpApiBuilder.group(Api, "server.skill", (handlers) =>
  handlers
    .handle("skill.list", () => response(SkillV2.Service.use((skill) => skill.list())))
    .handle("skill.catalog", () => response(HarnessSkills.catalog()))
    .handle("skill.setEnabled", (ctx) =>
      response(HarnessSkills.setEnabled(ctx.payload.name, ctx.payload.enabled)).pipe(
        Effect.mapError((error) =>
          error._tag === "HarnessSkills.UnknownSkill"
            ? new SkillNotFoundError({ reason: "not-found", message: error.message })
            : new SkillToggleWriteError({ reason: "write-failed", message: error.message }),
        ),
      ),
    ),
)
