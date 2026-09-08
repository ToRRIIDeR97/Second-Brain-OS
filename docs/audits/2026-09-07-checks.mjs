// Run from any directory with Node 24:
// node --experimental-transform-types docs/audits/2026-09-07-checks.mjs
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !specifier.endsWith(".ts"))
        return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});

const { ConfigMarkdown } = await import(
  "../../opencode/packages/core/src/config/markdown.ts"
);
const { assertAllowedApp } = await import(
  "../../opencode/packages/desktop/src/main/apps.ts"
);
const { requireWritableGoogleEvent } = await import(
  "../../opencode/packages/desktop/src/main/google-calendar-domain.ts"
);
const { assertRendererStoreName } = await import(
  "../../opencode/packages/desktop/src/main/store-name.ts"
);

const require = createRequire(import.meta.url);
const matter = require("../../opencode/packages/core/node_modules/gray-matter");
matter.clearCache();
const payload =
  '---javascript\n({title: (globalThis.__sboAuditMarker = "executed")})\n---\n# Audit\n';
assert.throws(
  () => ConfigMarkdown.parse(payload),
  /Executable frontmatter is not supported/,
);
assert.equal(globalThis.__sboAuditMarker, undefined);
for (let i = 0; i < 100; i++)
  ConfigMarkdown.parse(`---\ntitle: Audit ${i}\n---\nbody`);
assert.equal(Object.keys(matter.cache).length, 0);
console.log(
  "S1/P1 fixed: executable frontmatter is rejected without implicit parser caching",
);

assert.equal(
  assertRendererStoreName("opencode.global.dat"),
  "opencode.global.dat",
);
assert.throws(
  () => assertRendererStoreName("../outside.json"),
  /Invalid renderer store name/,
);
assert.throws(
  () => assertRendererStoreName("second-brain.google"),
  /Invalid renderer store name/,
);
console.log("S2 fixed: renderer storage is confined to public store names");

assert.equal(assertAllowedApp("Visual Studio Code"), "Visual Studio Code");
assert.throws(() => assertAllowedApp("/tmp/attacker"), /Invalid application/);
console.log("S3 fixed: renderer-selected applications use an allowlist");

assert.throws(
  () =>
    requireWritableGoogleEvent({
      id: "audit-event",
      attendees: [{ email: "guest@example.com" }],
      start: { date: "2026-09-07" },
      end: { date: "2026-09-08" },
    }),
  /google_write_requires_approval/,
);
console.log("S5 fixed: participant policy is evaluated from provider metadata");
