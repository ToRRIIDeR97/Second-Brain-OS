import { expect, test } from "bun:test"
import { ServerNetworkGuard } from "../../src/server/network-guard"

test("an unauthenticated server listens only on loopback", () => {
  for (const hostname of ["127.0.0.1", "localhost", "::1", "127.0.0.2"])
    expect(() => ServerNetworkGuard.assertExposureAllowed(hostname, undefined)).not.toThrow()
  for (const hostname of ["0.0.0.0", "::", "192.168.1.5", "example.local"])
    expect(() => ServerNetworkGuard.assertExposureAllowed(hostname, undefined)).toThrow()
  expect(() => ServerNetworkGuard.assertExposureAllowed("0.0.0.0", "")).toThrow()
})

test("a password allows any hostname", () => {
  expect(() => ServerNetworkGuard.assertExposureAllowed("0.0.0.0", "secret")).not.toThrow()
})
