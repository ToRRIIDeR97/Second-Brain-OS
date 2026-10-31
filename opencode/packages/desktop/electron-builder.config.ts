import { execFile, execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

// Without a Developer ID identity, electron-builder skips signing, but the fuse step has already broken
// Electron's own ad-hoc signature, and Apple Silicon kills the app at launch. Sign ad-hoc instead.
const hasMacIdentity = (() => {
  if (process.platform !== "darwin") return true
  if (process.env.CSC_LINK || process.env.CSC_NAME) return true
  try {
    return execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" }).includes(
      "Developer ID Application",
    )
  } catch {
    return false
  }
})()

// codesign rejects the Finder metadata that iCloud and other File Provider syncs keep re-adding to bundle
// folders under ~/Documents, so local macOS builds package outside the repository.
const outputDir =
  process.platform === "darwin" && process.env.GITHUB_ACTIONS !== "true"
    ? path.join(os.homedir(), "Library", "Caches", "tenon-workbench", "dist")
    : "dist"

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

// Tenon Workbench's own identity; `ai.opencode.desktop*` belongs to upstream OpenCode Desktop. Keep in
// sync with APP_IDS in src/main/index.ts.
const APP_IDS = {
  dev: "io.github.torriider97.tenonworkbench.dev",
  beta: "io.github.torriider97.tenonworkbench.beta",
  prod: "io.github.torriider97.tenonworkbench",
} as const

// Installer, package and install-folder names; the workspace package name "@opencode-ai/desktop"
// would otherwise become them.
const PACKAGE_NAMES = {
  dev: "tenon-workbench-dev",
  beta: "tenon-workbench-beta",
  prod: "tenon-workbench",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "tenon-workbench-${os}-${arch}.${ext}",
  // Release candidates are uploaded as artifacts. No automatic publishing or upstream update feed.
  publish: null,
  directories: {
    output: outputDir,
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "io.github.torriider97.tenonworkbench" becomes
  // "io.github.torriider97.tenonworkbench.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    name: PACKAGE_NAMES[channel],
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "!out/**/*.map", "resources/**/*", "!resources/opencode-cli*"],
  // Packaged builds cannot be turned into a general Node runtime or debugger by environment
  // variables or flags, and only load the integrity-checked app.asar. The sidecar runs through
  // utilityProcess and nothing spawns the app binary with ELECTRON_RUN_AS_NODE, so runAsNode is off.
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  extraResources: [
    ...(channel === "dev"
      ? [
          {
            from: "resources/",
            to: "",
            filter: ["opencode-cli*"],
          },
        ]
      : []),
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    ...(hasMacIdentity ? { notarize: true } : { identity: "-", notarize: false }),
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  // Matches DEEP_LINK_SCHEME in src/main/constants.ts.
  protocols: {
    name: "Tenon Workbench",
    schemes: ["tenon"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "Tenon Workbench Dev",
        deb: { packageName: PACKAGE_NAMES.dev, fpm: [metainfoFpm(appId)] },
        rpm: { packageName: PACKAGE_NAMES.dev, fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "Tenon Workbench Beta",
        protocols: { name: "Tenon Workbench Beta", schemes: ["tenon"] },
        deb: { packageName: PACKAGE_NAMES.beta, fpm: [metainfoFpm(appId)] },
        rpm: { packageName: PACKAGE_NAMES.beta, fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "Tenon Workbench",
        protocols: { name: "Tenon Workbench", schemes: ["tenon"] },
        deb: { packageName: PACKAGE_NAMES.prod, fpm: [metainfoFpm(appId)] },
        rpm: { packageName: PACKAGE_NAMES.prod, fpm: [metainfoFpm(appId)] },
      }
    }
  }
}

export default getConfig()
