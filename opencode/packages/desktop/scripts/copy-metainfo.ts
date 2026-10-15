import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "ai.opencode.desktop" : `ai.opencode.desktop.${channel}`
const productName =
  channel === "prod" ? "Tenon Workbench" : `Tenon Workbench ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = "Projects, knowledge, planning, and agent workflows"

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="io.github.ToRRIIDeR97">
    <name>Tenon Workbench contributors</name>
  </developer>

  <description>
    <p>
      Tenon Workbench organizes local files, projects, notes, calendar commitments, and agent work.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/ToRRIIDeR97/Second-Brain-OS/issues</url>
  <url type="homepage">https://github.com/ToRRIIDeR97/Second-Brain-OS</url>
  <url type="vcs-browser">https://github.com/ToRRIIDeR97/Second-Brain-OS</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
