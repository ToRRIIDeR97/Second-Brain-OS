import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  root,
  process.argv[2] ?? "docs/beta-evidence-v0.1.0.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packageVersion = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).version;
const requiredEvidence = [
  "local_regression",
  "release_metadata",
  "journey_note_graph",
  "journey_note_codex",
  "journey_terminal",
  "journey_google_planner",
  "journey_recovery",
  "macos_e2e",
  "windows_smoke",
  "linux_smoke",
  "security_clearance",
  "accessibility_screen_reader",
  "performance_scale",
  "migration_matrix",
  "signed_installers",
  "installer_checksums",
  "release_docs",
];
const automaticNoGoRules = [
  "canonical_file_loss",
  "silent_overwrite",
  "workspace_escape",
  "secret_leak",
  "approval_bypass",
  "unrecoverable_migration",
  "unconfirmed_participant_action",
];
const allowedStatuses = new Set(["pass", "fail", "missing", "blocked"]);
const blockers = [];
if (manifest.version !== packageVersion)
  blockers.push(
    `version mismatch: evidence ${manifest.version}, package ${packageVersion}`,
  );

const smoke = spawnSync(process.execPath, ["scripts/release-smoke.mjs"], {
  cwd: root,
  encoding: "utf8",
});
if (smoke.status !== 0) blockers.push("release_metadata: release smoke failed");

const evidence = new Map(
  manifest.evidence.map((item) => {
    if (!allowedStatuses.has(item.status))
      throw new Error(`invalid evidence status for ${item.id}`);
    return [item.id, item];
  }),
);
for (const id of requiredEvidence) {
  const item = evidence.get(id);
  if (!item) blockers.push(`${id}: evidence entry missing`);
  else if (item.status !== "pass")
    blockers.push(`${id}: ${item.status} — ${item.summary}`);
}

const rules = new Map(manifest.automaticNoGo.map((item) => [item.id, item]));
for (const id of automaticNoGoRules) {
  const item = rules.get(id);
  if (!item) blockers.push(`${id}: automatic no-go check missing`);
  else if (item.status === "observed")
    blockers.push(`${id}: automatic no-go incident observed`);
  else if (item.status !== "not_observed")
    blockers.push(`${id}: automatic no-go check untested`);
}

const computedDecision = blockers.length === 0 ? "GO" : "NO-GO";
if (manifest.decision !== computedDecision)
  blockers.push(
    `decision record mismatch: recorded ${manifest.decision}, computed ${computedDecision}`,
  );
const decision = blockers.length === 0 ? "GO" : "NO-GO";

console.log(`${decision}: Version ${manifest.version} beta gate`);
for (const blocker of blockers) console.log(`- ${blocker}`);
process.exitCode = decision === "GO" ? 0 : 1;
