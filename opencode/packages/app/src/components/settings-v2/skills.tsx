import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Switch as ToggleSwitch } from "@opencode-ai/ui/v2/switch-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import {
  type Accessor,
  type Component,
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createResource,
  createSignal,
} from "solid-js"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { listSkillCatalog, setSkillEnabled } from "@/utils/server"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { type CatalogSkill, type SkillSection, isBuiltInSkill, skillSections } from "./skills-sections"
import "./settings-v2.css"

/** Settings → Skills: Tenon's skills, which can be switched off, then each harness's skills, read-only. */
export const SettingsSkillsV2: Component<{ directory: Accessor<string | undefined> }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()
  const layout = useLayout()
  // Project skill folders depend on the location; outside a project, fall back like the Harnesses page.
  const directory = createMemo(
    () =>
      props.directory() ||
      layout.home.selection().directory ||
      layout.projects.list()[0]?.worktree ||
      serverSync().data.path.home ||
      undefined,
  )
  const server = () => ({ server: serverSdk().server.http, fetch: platform.fetch })
  const [catalog, { refetch }] = createResource(directory, (dir) => listSkillCatalog(server(), dir).then(skillSections))
  // One switch at a time per skill, so a slow save can't be overtaken by a second click.
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set())
  // Saved switches apply on top of the loaded catalog, so rows (and keyboard focus) stay in place.
  const [saved, setSaved] = createSignal<Readonly<Record<string, boolean>>>({})
  const reload = () => {
    setSaved({})
    void refetch()
  }
  const toggle = (name: string, enabled: boolean) => {
    const dir = directory()
    if (!dir || busy().has(name)) return
    setBusy((current) => new Set([...current, name]))
    void setSkillEnabled(server(), dir, name, enabled)
      .then((result) => setSaved((current) => ({ ...current, [result.name]: result.enabled })))
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setBusy((current) => new Set([...current].filter((item) => item !== name))))
  }

  return (
    <>
      <div class="settings-v2-tab-header flex items-center justify-between gap-3">
        <h2 class="settings-v2-tab-title">{language.t("secondBrain.skills.title")}</h2>
        <ButtonV2
          size="normal"
          variant="ghost"
          icon="reset"
          disabled={!directory() || catalog.loading}
          onClick={reload}
        >
          {language.t("secondBrain.skills.refresh")}
        </ButtonV2>
      </div>

      <div class="settings-v2-tab-body" data-component="skill-settings">
        <Switch>
          <Match when={!directory()}>
            <div class="settings-v2-provider-empty" role="alert">
              {language.t("secondBrain.skills.noLocation")}
            </div>
          </Match>
          <Match when={catalog.error}>
            <div class="settings-v2-provider-empty" role="alert">
              {catalog.error instanceof Error ? catalog.error.message : language.t("common.requestFailed")}
            </div>
          </Match>
          <Match when={catalog.loading && !catalog.latest}>
            <div class="settings-v2-provider-empty" role="status">
              {language.t("common.loading")}
              {language.t("common.loading.ellipsis")}
            </div>
          </Match>
          <Match when={catalog.latest}>
            {(sections) => (
              <For each={sections()}>
                {(section) => <SkillSectionView section={section} busy={busy()} saved={saved()} onToggle={toggle} />}
              </For>
            )}
          </Match>
        </Switch>
      </div>
    </>
  )
}

const SkillSectionView: Component<{
  section: SkillSection
  busy: ReadonlySet<string>
  saved: Readonly<Record<string, boolean>>
  onToggle: (name: string, enabled: boolean) => void
}> = (props) => {
  const language = useLanguage()
  const empty = () => {
    if (props.section.editable) return language.t("secondBrain.skills.empty.tenon")
    if (props.section.source === "none") return language.t("secondBrain.skills.empty.none")
    return language.t("secondBrain.skills.empty.filesystem")
  }

  return (
    <section class="settings-v2-section" data-component="skill-section" data-section={props.section.id}>
      <div class="flex min-w-0 items-center gap-2 pr-2">
        <h3 class="settings-v2-section-title">{props.section.title}</h3>
        <Show when={!props.section.editable}>
          <span class="flex shrink-0 items-center gap-1 text-[12px] leading-none text-v2-text-text-muted">
            <LockIcon />
            {language.t("secondBrain.skills.readOnly")}
          </span>
        </Show>
        <Show when={props.section.source === "reported"}>
          <span class="min-w-0 truncate text-[12px] leading-none text-v2-text-text-muted">
            {language.t("secondBrain.skills.source.reported")}
          </span>
        </Show>
      </div>
      <Show when={props.section.skills.length > 0} fallback={<div class="settings-v2-provider-empty">{empty()}</div>}>
        <SettingsListV2>
          <For each={props.section.skills}>
            {(skill) => (
              <SkillRow
                skill={skill}
                enabled={props.section.editable ? (props.saved[skill.name] ?? skill.enabled) : undefined}
                openable={props.section.editable}
                busy={props.busy.has(skill.name)}
                onToggle={(enabled) => props.onToggle(skill.name, enabled)}
              />
            )}
          </For>
        </SettingsListV2>
      </Show>
    </section>
  )
}

const SkillRow: Component<{
  skill: CatalogSkill
  /** Tenon skills only. */
  enabled: boolean | undefined
  openable: boolean
  busy: boolean
  onToggle: (enabled: boolean) => void
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  // Opening a path only makes sense when the server's files are on this machine.
  const canOpen = () => platform.platform === "desktop" && !!platform.openPath && server.isLocal()

  const failed = (error: unknown) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })

  const open = (location: string) => void platform.openPath?.(location).catch(failed)
  const copy = (location: string) =>
    void navigator.clipboard
      .writeText(location)
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("session.share.copy.copied"),
          description: location,
        }),
      )
      .catch(failed)

  return (
    <div data-component="settings-v2-row" data-enabled={props.enabled === false ? "false" : undefined}>
      <div data-slot="settings-v2-row-copy" classList={{ "opacity-60": props.enabled === false }}>
        <span data-slot="settings-v2-row-title" class="truncate">
          {props.skill.name}
        </span>
        <Show when={props.skill.description}>
          <span data-slot="settings-v2-row-description" class="line-clamp-2">
            {props.skill.description}
          </span>
        </Show>
        <Show when={props.skill.location}>
          {(location) => (
            <TooltipV2 value={location()} placement="bottom-start" class="min-w-0">
              <span
                class="block truncate font-mono text-[11px] leading-4 text-v2-text-text-muted"
                tabIndex={0}
                aria-label={location()}
              >
                {location()}
              </span>
            </TooltipV2>
          )}
        </Show>
      </div>
      <Show when={isBuiltInSkill(props.skill, props.openable)}>
        <span class="shrink-0 text-[12px] text-v2-text-text-muted">{language.t("secondBrain.skills.builtIn")}</span>
      </Show>
      <Show when={props.openable && props.skill.location}>
        {(location) => (
          <div class="flex shrink-0 items-center">
            <Show
              when={canOpen()}
              fallback={
                <IconButtonV2
                  type="button"
                  variant="ghost-muted"
                  size="normal"
                  aria-label={language.t("secondBrain.skills.copyPath")}
                  icon={<Icon name="outline-copy" />}
                  onClick={() => copy(location())}
                />
              }
            >
              <ButtonV2 size="normal" variant="ghost" onClick={() => open(location())}>
                {language.t("secondBrain.skills.openFile")}
              </ButtonV2>
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.openable && props.enabled !== undefined}>
        <ToggleSwitch checked={props.enabled !== false} disabled={props.busy} hideLabel onChange={props.onToggle}>
          {language.t("secondBrain.skills.enabled", { name: props.skill.name })}
        </ToggleSwitch>
      </Show>
    </div>
  )
}

// The v2 icon set has no lock glyph; this matches its 16px outline style.
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.5 7V5.25C4.5 3.317 6.067 1.75 8 1.75C9.933 1.75 11.5 3.317 11.5 5.25V7M3 7H13V14.25H3V7Z"
        stroke="currentColor"
        stroke-linejoin="round"
      />
    </svg>
  )
}
