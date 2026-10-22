export * as Skill from "./skill"

import { Schema } from "effect"
import { optional } from "./schema"
import { AbsolutePath } from "./schema"

export interface DirectorySource extends Schema.Schema.Type<typeof DirectorySource> {}
export const DirectorySource = Schema.Struct({
  type: Schema.Literal("directory"),
  path: AbsolutePath,
}).annotate({ identifier: "SkillV2.DirectorySource" })

export interface UrlSource extends Schema.Schema.Type<typeof UrlSource> {}
export const UrlSource = Schema.Struct({
  type: Schema.Literal("url"),
  url: Schema.String,
}).annotate({ identifier: "SkillV2.UrlSource" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.String.pipe(optional),
  slash: Schema.Boolean.pipe(optional),
  location: AbsolutePath,
  content: Schema.String,
}).annotate({ identifier: "SkillV2.Info" })

export interface EmbeddedSource extends Schema.Schema.Type<typeof EmbeddedSource> {}
export const EmbeddedSource = Schema.Struct({
  type: Schema.Literal("embedded"),
  skill: Schema.suspend(() => Info),
}).annotate({ identifier: "SkillV2.EmbeddedSource" })

export type Source = DirectorySource | UrlSource | EmbeddedSource
export const Source = Object.assign(
  Schema.Union([DirectorySource, UrlSource, EmbeddedSource]).pipe(
    Schema.toTaggedUnion("type"),
    Schema.annotate({ identifier: "SkillV2.Source" }),
  ),
  {
    equals: (a: Source, b: Source) => {
      if (a.type !== b.type) return false
      if (a.type === "directory" && b.type === "directory") return a.path === b.path
      if (a.type === "url" && b.type === "url") return a.url === b.url
      if (a.type === "embedded" && b.type === "embedded") return a.skill.name === b.skill.name
      return false
    },
    key: (source: Source) =>
      source.type === "directory"
        ? `directory:${source.path}`
        : source.type === "url"
          ? `url:${source.url}`
          : `embedded:${source.skill.name}`,
  },
)

/** A skill as the catalog lists it: where it lives, never its content. */
export interface CatalogSkill extends Schema.Schema.Type<typeof CatalogSkill> {}
export const CatalogSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.String.pipe(optional),
  location: Schema.String.pipe(optional),
  scope: Schema.Literals(["global", "project"]),
  /** Tenon skills only: false when switched off in Settings → Skills. */
  enabled: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "SkillV2.CatalogSkill" })

export interface HarnessCatalog extends Schema.Schema.Type<typeof HarnessCatalog> {}
export const HarnessCatalog = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.Literals(["filesystem", "reported", "none"]),
  skills: Schema.Array(CatalogSkill),
}).annotate({ identifier: "SkillV2.HarnessCatalog" })

/** Tenon's own skills, then each external harness's skills, read-only. */
export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export const Catalog = Schema.Struct({
  tenon: Schema.Array(CatalogSkill),
  harnesses: Schema.Array(HarnessCatalog),
}).annotate({ identifier: "SkillV2.Catalog" })
