export interface CatalogSkill {
  readonly name: string
  readonly description?: string
  readonly location?: string
  readonly scope: "global" | "project"
}

export type SkillSource = "filesystem" | "reported" | "none"

export interface SkillCatalog {
  readonly tenon: ReadonlyArray<CatalogSkill>
  readonly harnesses: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly source: SkillSource
    readonly skills: ReadonlyArray<CatalogSkill>
  }>
}

export interface SkillSection {
  readonly id: string
  readonly title: string
  /** Only Tenon's own skills belong to this app; harness skills are shown read-only. */
  readonly editable: boolean
  readonly source: SkillSource
  readonly skills: CatalogSkill[]
}

/** Settings → Skills sections: Tenon first, then each harness in catalog order, skills sorted by name. */
export function skillSections(catalog: SkillCatalog): SkillSection[] {
  return [
    { id: "tenon", title: "Tenon", editable: true, source: "filesystem", skills: sorted(catalog.tenon) },
    ...catalog.harnesses.map((harness) => ({
      id: harness.id,
      title: harness.name,
      editable: false,
      source: harness.source,
      skills: sorted(harness.skills),
    })),
  ]
}

function sorted(skills: ReadonlyArray<CatalogSkill>) {
  return skills.toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
}

/**
 * A Tenon skill without a file location ships inside the app. Harness sections can list location-less
 * entries too (commands a harness reported), and those are not built-in.
 */
export function isBuiltInSkill(skill: CatalogSkill, tenonSection: boolean) {
  return tenonSection && !skill.location
}
