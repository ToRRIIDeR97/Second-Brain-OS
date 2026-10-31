import { Effect, Layer, LayerMap } from "effect"
import { AgentV2 } from "./agent"
import { AISDK } from "./aisdk"
import { Catalog } from "./catalog"
import { CommandV2 } from "./command"
import { Config } from "./config"
import { LayerNode } from "./effect/layer-node"
import { Node } from "./effect/app-node"
import { FileMutation } from "./file-mutation"
import { FileSystem } from "./filesystem"
import { FileSystemSearch } from "./filesystem/search"
import { Watcher } from "./filesystem/watcher"
import { Image } from "./image"
import { HarnessRuntime } from "./harness"
import { Integration } from "./integration"
import { Location } from "./location"
import { LocationMutation } from "./location-mutation"
import { LocationServiceMap } from "./location-service-map"
import { PermissionV2 } from "./permission"
import { PluginV2 } from "./plugin"
import { PluginInternal } from "./plugin/internal"
import { Policy } from "./policy"
import { ProjectCopy } from "./project/copy"
import { Pty } from "./pty"
import { QuestionV2 } from "./question"
import { Reference } from "./reference"
import { ReferenceGuidance } from "./reference/guidance"
import * as SessionRunnerLLM from "./session/runner/llm"
import { SessionRunnerModel } from "./session/runner/model"
import { SessionTodo } from "./session/todo"
import { SkillV2 } from "./skill"
import { SkillGuidance } from "./skill/guidance"
import { Snapshot } from "./snapshot"
import { SystemContextBuiltIns } from "./system-context/builtins"
import { SystemContextRegistry } from "./system-context/registry"
import { BuiltInTools } from "./tool/builtins"
import { ReadToolFileSystem } from "./tool/read-filesystem"
import { ToolRegistry } from "./tool/registry"
import { ToolOutputStore } from "./tool-output-store"
import { AbsolutePath } from "./schema"
import { canonicalDirectory } from "./util/directory"

export { LocationServiceMap } from "./location-service-map"

export const locationServices = LayerNode.group([
  Location.node,
  Policy.node,
  Config.node,
  AgentV2.node,
  CommandV2.node,
  Reference.node,
  Integration.node,
  Catalog.node,
  AISDK.node,
  PluginV2.node,
  PluginInternal.node,
  ProjectCopy.node,
  ProjectCopy.refreshNode,
  FileSystemSearch.node,
  FileSystem.node,
  Watcher.node,
  Pty.node,
  SkillV2.node,
  SystemContextRegistry.node,
  SystemContextBuiltIns.node,
  LocationMutation.node,
  FileMutation.node,
  PermissionV2.node,
  ToolOutputStore.node,
  ToolRegistry.node,
  ToolRegistry.toolsNode,
  Image.node,
  SkillGuidance.node,
  ReferenceGuidance.node,
  SessionTodo.node,
  QuestionV2.node,
  HarnessRuntime.node,
  ReadToolFileSystem.node,
  BuiltInTools.node,
  SessionRunnerModel.node,
  Snapshot.node,
  SessionRunnerLLM.node,
])

export type LocationServices = LayerNode.Output<typeof locationServices>
export type LocationError = LayerNode.Error<typeof locationServices>

// Graphs that only replace nodes outside the location services share one map Layer, so the shared
// memo map builds it once and a folder boots once (it used to boot in each of three maps).
const sharedMaps = new Map<string, Layer.Layer<LocationServiceMap.Service>>()
const targetIDs = new WeakMap<object, number>()
let nextTargetID = 0
const targetID = (target: object) => targetIDs.get(target) ?? targetIDs.set(target, ++nextTargetID).get(target)!

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  const relevant = replacements.filter(([source]) => LayerNode.contains(locationServices, source))
  const key = relevant.map(([source, target]) => `${source.name}>${targetID(target)}`).join("|")
  const shared = sharedMaps.get(key)
  if (shared) return shared
  const built = makeLocationServiceMap(relevant)
  sharedMaps.set(key, built)
  return built
}

function makeLocationServiceMap(replacements: LayerNode.Replacements): Layer.Layer<LocationServiceMap.Service> {
  return Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make(
      (ref: Location.Ref) => {
        const allReplacements = replacements.concat([[Location.node, Location.boundNode(ref)]])
        // Apply replacements during hoist, not afterward: replacements can
        // introduce new tagged dependencies (Location.boundNode depends on
        // Project), and the hoist walk is the only pass that can still slice
        // those back out.
        const location = LayerNode.hoist(locationServices, Node.tags.values.global, allReplacements)

        return LayerNode.compile(location.node).pipe(
          Layer.fresh,
          Layer.tap(() =>
            Effect.logInfo("booting location services", {
              directory: ref.directory,
              workspaceID: ref.workspaceID,
            }),
          ),
          Layer.provide(LayerNode.compile(location.hoisted)),
        )
      },
      { idleTimeToLive: "60 minutes" },
    ).pipe(Effect.map(canonicalKeys)),
  )
}

// Callers pass directories spelled however they arrived (C:/a, c:\a\), and some pass
// `workspaceID: undefined` where others leave it out; keys compare structurally, so both
// would boot the folder again. Key the map by one spelling and one shape.
function canonicalKeys<I, E>(map: LayerMap.LayerMap<Location.Ref, I, E>): LayerMap.LayerMap<Location.Ref, I, E> {
  const key = (ref: Location.Ref): Location.Ref => {
    const directory = AbsolutePath.make(canonicalDirectory(ref.directory))
    return ref.workspaceID === undefined ? { directory } : { directory, workspaceID: ref.workspaceID }
  }
  return Object.assign(Object.create(map), {
    get: (ref: Location.Ref) => map.get(key(ref)),
    contextEffect: (ref: Location.Ref) => map.contextEffect(key(ref)),
    invalidate: (ref: Location.Ref) => map.invalidate(key(ref)),
  })
}

// This is temporary for backwards compatibility. It is the same cached Layer the app graph builds,
// so runtimes sharing a memo map also share the folder services.
export const locationServiceMapLayer = buildLocationServiceMap()

