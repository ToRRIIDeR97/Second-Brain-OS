import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const channels = [
  { channel: "dev", appId: "io.github.torriider97.tenonworkbench.dev", name: "tenon-workbench-dev" },
  { channel: "beta", appId: "io.github.torriider97.tenonworkbench.beta", name: "tenon-workbench-beta" },
  { channel: "prod", appId: "io.github.torriider97.tenonworkbench", name: "tenon-workbench" },
] as const

for (const channel of channels) {
  test(`uses one Linux desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.OPENCODE_CHANNEL
    process.env.OPENCODE_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.productName).toStartWith("Tenon Workbench")
    expect(config.publish).toBeNull()
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    // Nothing may reuse upstream OpenCode Desktop's identity.
    expect(config.extraMetadata?.name).toBe(channel.name)
    expect(config.deb?.packageName).toBe(channel.name)
    expect(config.rpm?.packageName).toBe(channel.name)
    expect(config.protocols).toEqual(expect.objectContaining({ schemes: ["tenon"] }))
    expect(JSON.stringify(config)).not.toContain("ai.opencode.desktop")
  })
}
