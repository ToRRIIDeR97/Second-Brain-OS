# Agent provider compatibility

Provider payloads are accepted only through documented structured interfaces
and are normalized before they reach session state or UI.

- Codex managed mode requires an explicit App Server protocol probe matching a
  recorded supported version. No supported live range is declared until a real
  App Server fixture is captured and exercised in CI.
- Codex visible mode uses the backend-owned `codex` terminal preset.
- Claude managed mode is disabled unless capability detection confirms a
  documented structured protocol and its feature flag is enabled.
- Claude visible mode uses the backend-owned `claude` terminal preset and is
  the honest fallback when managed capability is absent.

Unknown, duplicate, late, malformed, or newer events cannot expand roots or
permissions. Hidden reasoning and raw terminal output are never normalized as
authoritative knowledge. Updating a provider fixture requires recording only
the minimal redacted lifecycle, tool, approval, usage, and completion fields,
then running the provider state-machine tests before changing the declared
protocol range.
