# Version 0.1.0 beta acceptance record

**Decision: NO-GO**

**Evaluated:** 2026-07-28
**Record status:** unsigned engineering record; no release approver signature

Run the fail-closed gate:

```sh
node scripts/beta-gate.mjs
```

The machine-readable evidence is
[`beta-evidence-v0.1.0.json`](beta-evidence-v0.1.0.json). The gate owns the
fixed list of required evidence IDs and automatic no-go rules; deleting a
missing item from the manifest cannot turn the decision into GO.

## Acceptance matrix

| Category                            | Result | Evidence                                                     |
| ----------------------------------- | ------ | ------------------------------------------------------------ |
| Local Rust regression               | Pass   | `cargo test --workspace --locked`: 105 passed                |
| Local frontend regression           | Pass   | Vitest: 19 files and 51 tests passed                         |
| Release metadata compatibility      | Pass   | `node scripts/release-smoke.mjs`                             |
| Note → graph journey                | Block  | Complete installed-app E2E absent                            |
| Note → managed Codex journey        | Block  | Live Codex/approval/diff recording absent                    |
| Terminal journey                    | Block  | Installed-app folder/tab/agent/link E2E absent               |
| Google planner journey              | Block  | Live OAuth/sync/write/conflict evidence absent               |
| Backup/recovery journey             | Block  | Restore covered; canonical-file rebuild demonstration absent |
| macOS installed beta smoke          | Block  | Source build only; no installed beta                         |
| Windows installed beta smoke        | Block  | Not run                                                      |
| Linux installed beta smoke          | Block  | Not run                                                      |
| Security release clearance          | Block  | Required final reviews remain open                           |
| Accessibility                       | Block  | Automated semantics pass; screen reader not run              |
| Performance                         | Block  | Small policy harness only; scale/soak fixtures absent        |
| Migration compatibility             | Block  | Full supported-version/interruption matrix absent            |
| Signed installers and hashes        | Block  | No signed installers or archived hashes                      |
| User/recovery/privacy documentation | Pass   | Release and recovery runbooks                                |

Component and recorded-provider tests are valuable regression evidence, but
they are not substituted for the required installed-app or live-provider
journeys.

## Automatic no-go review

No workspace escape, secret leak, approval bypass, silent overwrite, or
unconfirmed participant action was observed in the automated suite. Canonical
file preservation across installer recovery and recoverability across the full
migration matrix remain untested; both are automatic no-go conditions until
demonstrated.

## Risk and known-limitations register

| ID     | Severity | Risk/limitation                                                         | Required disposition                                          |
| ------ | -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| B37-01 | Critical | No signed/notarized beta installers or clean-machine launch proof       | Produce, verify, and archive three-OS installer evidence      |
| B37-02 | Critical | Four primary installed-app journeys and executive vertical slice absent | Record secret-free macOS E2E evidence                         |
| B37-03 | High     | Live Google and managed Codex behavior unverified                       | Run dedicated test accounts and approval flows                |
| B37-04 | High     | Full rebuild and migration interruption/every-version matrix absent     | Run destructive fixture matrix with rollback proof            |
| B37-05 | High     | Final dependency/viewer/terminal/capability security review incomplete  | Close high findings and rerun gate                            |
| B37-06 | High     | Supported screen reader not tested                                      | Complete and record primary target session                    |
| B37-07 | High     | Channel registry is not selected by application startup                 | Wire and verify beta defaults before packaging                |
| B37-08 | High     | MCP sidecar is not bundled and signature-bound to the app               | Package target-specific sidecars and verify identity/protocol |
| B37-09 | Medium   | Large-scale and long-session performance evidence absent                | Run specified scale/soak fixtures per target                  |
| B37-10 | Medium   | Uninstall data behavior and interrupted update behavior untested        | Add clean-machine installer matrix                            |

## Beta checklist

- [x] Local Rust and frontend regression suites pass.
- [x] Version, MCP protocol, and configured icon smoke passes.
- [x] Recovery, privacy, install, upgrade, rollback, and troubleshooting docs exist.
- [ ] All five required journeys pass on installed macOS beta.
- [ ] Windows and Linux installed beta smoke passes.
- [ ] Full rebuild and migration compatibility matrix passes.
- [ ] Final high/critical security review is clear.
- [ ] Supported screen-reader and manual accessibility matrix passes.
- [ ] Required performance scale and soak fixtures pass.
- [ ] Sidecar is bundled, version-matched, and replacement-resistant.
- [ ] Signing/notarization verification and installer hashes are archived.
- [ ] Release approver signs the evidence record.

## Go/no-go record

The computed and recorded decision is **NO-GO**. Release remains blocked until
every fixed required evidence item is `pass`, every automatic no-go check is
`not_observed` with traceable evidence, the gate exits zero, and an authorized
release approver signs the archived record. No exception in this document
waives an automatic no-go rule.
