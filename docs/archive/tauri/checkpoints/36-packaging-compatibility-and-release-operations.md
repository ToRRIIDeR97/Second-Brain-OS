# Checkpoint 36: Packaging, Compatibility, and Release Operations

## Outcome

The app can be reproducibly packaged, signed, installed, upgraded, rolled back, and diagnosed through developer, alpha, beta, and stable channels.

## Source plan

- Sections 6.7 and 32
- Phase 15 packaging portion
- Backlog L011-L012

## Prerequisites

- Checkpoints 34-35

## Scope

- Configure Tauri packaging for macOS, Windows, and Linux.
- Add signing/notarization plans and production CI secret boundaries.
- Package and version-match the MCP sidecar and shell integration.
- Implement feature flags and channel configuration.
- Enforce app, database, manifest, Markdown, MCP, adapter, and context compatibility.
- Add signed update only after rollback is proven; otherwise ship manual updates for beta.
- Write installation, upgrade, rollback, backup, recovery, privacy, and troubleshooting documentation.

## Expected artifacts

- Reproducible release pipeline.
- Platform installers and checksum/signature artifacts.
- Compatibility matrix and release checklist.
- Feature-flag registry.
- User/admin documentation.
- Upgrade/rollback smoke tests.

## Work items

1. Make developer/alpha/beta/stable identifiers and update feeds distinct.
2. Bundle only required capabilities, sidecar, and shell assets.
3. Verify signing identities are never exposed to untrusted build steps.
4. Test clean install, in-place upgrade, downgrade refusal/rollback, and uninstall data behavior.
5. Verify migrations/backups within installer upgrade paths.
6. Gate risky features such as semantic retrieval, managed Claude, raw HTML, Google writes, recurrence, and auto-update.
7. Generate release notes with schema/protocol compatibility.

## Acceptance evidence

- Beta installers launch on supported macOS, Windows, and Linux smoke environments.
- macOS signing/notarization and applicable Windows signing verify.
- Installed sidecar matches app protocol and cannot be silently replaced.
- Upgrade preserves canonical files and successfully migrates local state.
- A tested rollback or documented safe recovery exists.
- Release documentation accurately covers permissions, data locations, backups, and diagnostics.

## Validation focus

- Clean machine without developer tools
- OS security prompts and permissions
- Sidecar executable permissions
- Code-signing reproducibility
- Update interruption

## Out of scope

Mobile packages, cloud-hosted sync, unsupported OS versions, and public stable launch approval.

## Handoff

Provide installer hashes, signing verification, compatibility matrix, and upgrade/rollback evidence to the final beta gate.
