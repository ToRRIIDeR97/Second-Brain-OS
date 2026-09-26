# Release operations for the former Tauri app

These commands and the current `.github/workflows/` files cover the legacy
React/Tauri application in `app/`. Release procedures for the active
OpenCode Electron fork have not been verified in this repository.

Checkpoint 36 provides an unsigned release-candidate pipeline and local smoke
checks. It does not claim that signed/notarized packages, clean-machine
installers, or update feeds were produced.

## Local release smoke

```sh
node scripts/release-smoke.mjs
cargo test -p second-brain-os platform::release::tests
pnpm desktop:build
```

The smoke script requires application versions and MCP protocol constants to
match and verifies every configured icon exists. Tauri builds the current
platform only. The sidecar is built separately until its target-triple
packaging and signature verification are wired.

## Channels and feature flags

| Channel   | Identifier                     | Logical feed     | Defaults                                                      |
| --------- | ------------------------------ | ---------------- | ------------------------------------------------------------- |
| Developer | `com.secondbrain.os.developer` | `developer.json` | All gated features except auto-update                         |
| Alpha     | `com.secondbrain.os.alpha`     | `alpha.json`     | Semantic retrieval, managed Claude, Google writes, recurrence |
| Beta      | `com.secondbrain.os.beta`      | `beta.json`      | Semantic retrieval and Google writes                          |
| Stable    | `com.secondbrain.os`           | `stable.json`    | All risky features disabled                                   |

Raw HTML is developer-only. Auto-update is disabled in every channel until
signed feeds and an interruption-tested rollback exist. Logical feed names are
reserved identifiers, not deployed URLs. Automatic agent writes, background
derived extraction, and large graph views are developer-only defaults.

## Release candidate workflow

Run **Unsigned release candidate** manually for developer, alpha, or beta. It
uses pinned Node, pnpm, and Rust versions; frozen/locked dependency resolution;
the existing three-OS build matrix; and SHA-256 manifests. Uploaded artifacts
are explicitly named `unsigned-*` and expire after 14 days.

Before a production release:

1. Run full CI, security/advisory, license, accessibility, and migration gates.
2. Build the sidecar for each target triple and configure it as a Tauri
   external binary.
3. Sign the app and sidecar in a trusted job that runs after all untrusted
   build/test steps. Expose signing secrets only to that job.
4. Verify macOS signing/notarization and applicable Windows signing on clean
   machines.
5. Install, launch, exercise MCP initialization, and record installer hashes.

## Install and permissions

Use only an installer produced for the target OS and verify its published
SHA-256 value. The application needs access only to workspaces the user
registers, its local application-data directory, explicitly connected provider
accounts, and approved terminal/agent capabilities. OS security prompts must
not be bypassed.

Current source builds are developer artifacts. Cross-platform installers have
not been smoke-tested on clean machines.

## Upgrade

1. Export diagnostics and create a verified online database backup.
2. Close the app cleanly.
3. Verify the new installer checksum and install in place.
4. Launch and confirm database, index, provider, planner outbox, agent, and MCP
   protocol health.
5. Keep the rollback backup until canonical files and critical workflows are
   verified.

Newer database schemas and MCP protocol mismatches fail closed. Canonical
workspace files are not migration targets and must not be overwritten.

## Rollback and recovery

Do not install an older binary over a newer database. Uninstall/reinstall the
previous application binary, then restore the compatible verified database
backup using the [recovery runbook](recovery.md). If no usable database backup
exists, rebuild derived search and graph state from canonical workspace files,
then reconnect providers and recreate MCP clients.

Uninstall behavior for local application data is platform/installer-specific
and has not been clean-machine tested. Back up before uninstalling; never
assume uninstall preserves or deletes user data.

## Privacy

Canonical files stay in user-selected workspaces. Rebuildable state, audit
metadata, logs, and backups live under the platform application-data directory.
Provider credentials belong in the operating-system credential store.
Diagnostics exports exclude note bodies, credentials, environment variables,
provider payloads, local paths, and terminal scrollback.

Semantic retrieval and provider writes are feature-gated. Raw HTML remains
disabled outside developer builds. Release artifacts must never include local
databases, logs, diagnostics, `.env` files, credentials, signing keys, or
workspace fixtures containing private content.

## Troubleshooting

- **Protocol mismatch:** install matching app and sidecar versions; do not
  bypass initialization.
- **Database newer than app:** reinstall the newer app or restore a compatible
  backup; do not force migration metadata.
- **Provider disconnected:** reconnect through the provider flow; credentials
  are machine-local.
- **Index/search unhealthy:** preserve canonical files and rebuild derived
  state.
- **Installer rejected by the OS:** this unsigned pipeline is not a production
  installer. Do not bypass OS security prompts.
- **Support request:** export the redacted support bundle and include the
  installer checksum, channel, app version, OS version, and reproduction steps.
