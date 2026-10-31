import { describe, expect, test } from "bun:test"
import { androidText, parseAdbDevices, parseSimctl } from "./device"

describe("device parsing", () => {
  test("reads adb devices -l", () => {
    const out = [
      "List of devices attached",
      "emulator-5554          device product:sdk_gphone64 model:sdk_gphone64_x86_64 device:emu64x transport_id:1",
      "R58N12345             unauthorized usb:1-1 transport_id:2",
      "",
    ].join("\n")
    expect(parseAdbDevices(out)).toEqual([
      { platform: "android", id: "emulator-5554", state: "device", name: "sdk gphone64 x86 64" },
      { platform: "android", id: "R58N12345", state: "unauthorized", name: "R58N12345" },
    ])
  })

  test("reads available iOS simulators from simctl", () => {
    const out = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
          { udid: "A1", name: "iPhone 16", state: "Booted", isAvailable: true },
          { udid: "A2", name: "iPhone SE", state: "Shutdown", isAvailable: false },
        ],
        "com.apple.CoreSimulator.SimRuntime.watchOS-12-0": [{ udid: "W1", name: "Watch", state: "Shutdown" }],
      },
    })
    expect(parseSimctl(out)).toEqual([{ platform: "ios", id: "A1", name: "iPhone 16", state: "Booted" }])
  })

  test("escapes text for adb input", () => {
    expect(androidText("hello world")).toBe("hello%sworld")
    expect(androidText("a&b;c")).toBe("a\\&b\\;c")
    expect(androidText("me@test.dev")).toBe("me@test.dev")
  })
})
