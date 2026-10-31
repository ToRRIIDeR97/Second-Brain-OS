import type { Prompt } from "@/context/prompt"

// A skill chip in the composer is a file mention with this MIME type. It is never sent as a file:
// on submit each chip becomes a synthetic text part. A Tenon skill carries its instructions, so every
// harness reads the same text; a harness's own skill is named for that harness to load itself.
export const SKILL_REFERENCE_MIME = "application/x-tenon-skill"

export const skillReferenceURI = (name: string) => `tenon-skill://${encodeURIComponent(name)}`

export const promptSkills = (prompt: Prompt) => [
  ...new Set(prompt.flatMap((part) => (part.type === "file" && part.mime === SKILL_REFERENCE_MIME ? [part.path] : []))),
]

export const skillInstruction = (name: string, content?: string) =>
  content === undefined
    ? `The user attached your "${name}" skill to this message. Load it and follow its instructions for this request.`
    : [
        `The user attached the "${name}" skill to this message. Follow its instructions for this request.`,
        `<skill name="${name}">`,
        content.trim(),
        "</skill>",
      ].join("\n")
