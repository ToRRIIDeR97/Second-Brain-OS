# Regenerate from the repository root: python3 docs/diagrams/generate/structural.py docs/diagrams
import sys
from svg import SVG

OUT = sys.argv[1]


def component():
    s = SVG(980, 790, "Component view of Second Brain OS",
            "UML component view: Solid renderer, preload bridge, Electron main, the bundled OpenCode server "
            "with HTTP API, Second Brain domains, location services and agent runtime, plus stores and external services.")
    s.heading("Component view", "UML 2.5.1 component diagram · paths relative to opencode/packages/")
    # left column
    s.box(20, 70, 250, 160, "Solid renderer", ["app/src", "routes: Home, Notes, Calendar,", "Projects, Activity, sessions",
          "ServerSDK + compat API (v1/v2)", "Second Brain client"], stereo="component")
    s.box(20, 280, 250, 64, "window.api", ["desktop/src/preload (contextBridge)"], stereo="interface")
    s.box(20, 390, 250, 170, "Electron main", ["desktop/src/main", "IPC registry (ipc.ts)", "windows + URL policy",
          "server launcher (server.ts)", "Google Calendar/Tasks service", "drafts, session export"], stereo="component")
    s.box(20, 590, 200, 60, "userData stores", ["drafts.sqlite, electron-store", "(second-brain.google)"], cls="store")
    # server container
    s.zone(340, 60, 360, 570, "OpenCode server «subsystem» · 127.0.0.1")
    s.box(360, 90, 290, 104, "HTTP API", ["native /api: server + protocol pkgs", "legacy: opencode/src/server",
          "Basic auth, workspace routing", "→ domains and SessionV2"], cls="sub")
    s.box(360, 215, 290, 104, "Second Brain domains", ["opencode/src/knowledge/note.ts", "opencode/src/project/brain.ts",
          "opencode/src/planner/calendar.ts", "SecondBrainApi handlers"], cls="sub")
    s.box(360, 340, 290, 80, "Location services", ["core: LocationMutation, FileMutation", "path containment, CAS writes"], cls="sub")
    s.box(360, 440, 290, 170, "Agent runtime", ["core/src/session: SessionV2,", "SessionInput, SessionRunner",
          "core/src/harness.ts: HarnessRuntime", "drivers: opencode, codex, acp", "core/src/permission.ts: PermissionV2",
          "EventV2 (durable events), Snapshot", "harness/registry.ts"], cls="sub")
    # stores
    s.box(760, 335, 200, 76, "Workspace files", ["notes/, projects/,", ".second-brain/calendar-v1.json"], cls="store")
    s.box(760, 445, 200, 56, "Profile SQLite", ["sessions, events, permissions"], cls="store")
    s.box(760, 515, 200, 44, "Snapshot git repo", [], cls="store")
    s.box(760, 573, 200, 44, "harnesses.json (0600)", [], cls="store")
    s.box(760, 631, 200, 56, "auth.json (XDG data)", ["provider credentials"], cls="store")
    # externals
    s.box(20, 705, 200, 60, "Google APIs", ["Calendar v3, Tasks v1"], cls="ext", stereo=None)
    s.box(340, 705, 150, 60, "Codex app-server", ["child process"], cls="proc")
    s.box(510, 705, 160, 60, "ACP agents", ["registered commands"], cls="proc")
    s.box(690, 705, 190, 60, "LLM provider APIs", ["opencode driver"], cls="ext")
    # edges
    s.edge([(145, 230), (145, 280)], "invoke / on", at=(190, 258))
    s.edge([(145, 344), (145, 390)], "IPC", at=(170, 370))
    s.edge([(120, 560), (120, 590)])
    s.edge([(245, 560), (245, 705)], "OAuth PKCE,\nREST", at=(290, 640))
    s.edge([(270, 150), (360, 150)], "HTTP + SSE\nBasic auth", at=(310, 128))
    s.edge([(270, 540), (360, 540)], "fork,\nstart/stop", at=(305, 520))
    s.edge([(505, 194), (505, 215)])
    s.edge([(505, 319), (505, 340)])
    s.edge([(360, 175), (350, 175), (350, 470), (360, 470)])
    s.edge([(650, 380), (760, 373)], "validated\nrelative paths", at=(705, 360))
    s.edge([(650, 473), (760, 473)], "durable events", at=(705, 466))
    s.edge([(650, 537), (760, 537)], "capture/diff", at=(705, 530))
    s.edge([(650, 595), (760, 595)], "registry", at=(705, 588))
    s.edge([(415, 610), (415, 705)], "JSON-RPC stdio", at=(415, 668))
    s.edge([(590, 610), (590, 705)], "ACP stdio", at=(590, 668))
    s.edge([(640, 610), (760, 705)], "HTTPS", at=(722, 690))
    s.save(f"{OUT}/component-overview.svg")


def trust():
    s = SVG(1000, 706, "Trust boundaries and sensitive-data flow",
            "Trust zones of the desktop app: sandboxed renderer, privileged Electron main, loopback server, workspace "
            "files, harness child processes and external services, with the control at each crossing and known gaps in red.")
    s.heading("Trust boundaries and sensitive data", "dashed = trust zone · orange = sensitive data · red = known gap (see threat model)")
    s.zone(20, 70, 230, 230, "Renderer sandbox (untrusted input)")
    s.box(40, 100, 190, 74, "Solid renderer", ["contextIsolation, sandbox,", "no nodeIntegration"], cls="sub")
    s.box(40, 190, 190, 90, "Untrusted inputs", ["note bodies, URLs, IPC args,", "provider + agent output,", "workspace content"], cls="sub")
    s.zone(20, 330, 230, 290, "Electron main (privileged)")
    s.box(40, 360, 190, 84, "IPC handlers", ["allowlisted channels", "session export: basename,", "≤32 MiB, native dialog"], cls="sub")
    s.box(40, 456, 190, 66, "Google service", ["PKCE loopback OAuth", "safeStorage-encrypted secrets"], cls="sub")
    s.box(40, 534, 190, 70, "Profile data", ["drafts.sqlite (plaintext)", "electron-store files"], cls="store")
    s.zone(300, 70, 330, 380, "Loopback server process")
    s.box(320, 100, 290, 74, "Authorization", ["Basic auth opencode:<uuid>", "header or auth_token query"], cls="sub")
    s.box(320, 186, 290, 70, "Workspace routing", ["directory → instance", "LocationMutation containment"], cls="sub")
    s.box(320, 268, 290, 84, "PermissionV2", ["rules: allow / ask / deny", "harness_register: alwaysAsk", "plan agent denies edits"], cls="sub")
    s.box(320, 364, 220, 70, "Secrets at rest", ["auth.json (XDG data)", "SQLite profile, harnesses.json"], cls="store")
    s.zone(680, 70, 300, 150, "Workspace filesystem")
    s.box(700, 100, 260, 100, "Canonical files", ["notes/, projects/", ".second-brain/calendar-v1.json", "source of truth"], cls="store")
    s.zone(680, 250, 300, 180, "Harness child processes (run as user)")
    s.box(700, 280, 260, 64, "Codex / ACP agents", ["own tools; ask via request_permission"], cls="proc")
    s.box(700, 354, 260, 60, "Filtered environment", ["allowlist + per-harness env"], cls="proc")
    s.zone(300, 480, 680, 140, "External network")
    s.box(320, 512, 200, 84, "Google APIs", ["oauth2, Calendar, Tasks", "via net.fetch"], cls="ext")
    s.box(540, 512, 200, 84, "LLM providers", ["prompts include", "workspace content"], cls="ext")
    s.box(760, 512, 200, 84, "System browser", ["http/https/mailto only", "via shell.openExternal"], cls="ext")
    s.edge([(230, 137), (260, 137), (260, 400), (230, 400)], "preload\nIPC", at=(280, 260))
    s.edge([(230, 120), (320, 120)], "HTTP 127.0.0.1", at=(275, 113), cls="sens", head="as")
    s.edge([(610, 221), (700, 160)], "validated\nrelative paths", at=(655, 182), cls="sens", head="as")
    s.edge([(610, 310), (700, 310)], "spawn + stdio", at=(655, 303))
    s.edge([(700, 330), (630, 330)], "", head="a")
    s.edge([(230, 489), (300, 540), (320, 540)], "tokens", at=(282, 530), cls="sens", head="as")
    s.edge([(575, 352), (575, 500), (640, 500), (640, 512)], "prompts + context", at=(615, 470), cls="sens", head="as")
    s.edge([(230, 425), (282, 425), (282, 608), (860, 608), (860, 596)], "open-external", at=(560, 612))
    s.box(20, 636, 960, 56, "Known gaps (threat model)", ["auth_token accepted in URLs · open-path/reveal-path take raw paths · store names unvalidated · senderFrame unchecked · drafts unencrypted · per-harness env visible to that harness"], cls="gapz")
    s.save(f"{OUT}/trust-boundaries.svg")


def deployment():
    s = SVG(1000, 640, "Deployment view of Second Brain OS",
            "UML deployment view: the user's machine runs the Electron main, renderer and utility-process server, optional "
            "harness processes and CLI daemon, with userData, XDG data and workspace artifacts, plus external services.")
    s.heading("Deployment view", "UML 2.5.1 deployment diagram · unsigned development candidates; auto-update disabled")
    s.zone(20, 70, 740, 555, "«device» user machine")
    s.zone(40, 100, 450, 300, "«executionEnvironment» Electron app")
    s.box(60, 130, 200, 86, "Main process", ["out/main/index.js", "app id ai.opencode.desktop.*"], stereo="process")
    s.box(270, 130, 200, 86, "Renderer process", ["oc://renderer/index.html", "out/preload/index.js"], stereo="process")
    s.box(60, 240, 410, 70, "Utility process “opencode server”", ["virtual:opencode-server = opencode/dist/node/node.js",
          "listens on 127.0.0.1:<ephemeral>"])
    s.box(60, 322, 200, 64, "OAuth loopback server", ["127.0.0.1:0, ≤5 min"], cls="sub")
    s.box(270, 322, 200, 64, "opencode-cli daemon", ["opt-in v2, dev channel only"], cls="sub")
    s.box(510, 100, 230, 76, "Harness processes", ["codex app-server, ACP agents", "spawned by server, stdio", "cwd = workspace"], cls="proc")
    s.box(510, 190, 230, 50, "WSL sidecars", ["Windows only, optional"], cls="proc")
    s.box(40, 430, 230, 182, "userData = appData/<appId>", ["opencode.settings, opencode.updater", "second-brain.google",
          "drafts.sqlite (+wal/shm)", "window-state-<id>.json", "logs/<stamp>/, Crashpad/", "opencode/ server state",
          "(XDG_STATE_HOME default)", "cli/<ver>/opencode-cli (v2)"], cls="store")
    s.box(290, 430, 200, 100, "XDG data/opencode", ["auth.json, mcp-auth.json", "profile SQLite, snapshots"], cls="store")
    s.box(290, 545, 200, 64, "Global config dir", ["harnesses.json"], cls="store")
    s.box(510, 430, 230, 90, "Workspace directories", ["notes/, projects/", ".second-brain/"], cls="store")
    s.box(800, 100, 180, 60, "Google APIs", ["oauth2, calendar v3,", "tasks v1"], cls="ext")
    s.box(800, 180, 180, 60, "LLM provider APIs", ["opencode driver, agents"], cls="ext")
    s.box(800, 260, 180, 50, "System browser", [], cls="ext")
    s.box(800, 340, 180, 118, "Build host", ["bun run desktop:build", "prebuild: build-node.ts", "electron-builder,", "publish: null →",
          "installer + SHA-256"], cls="sub")
    s.edge([(260, 172), (270, 172)])
    s.edge([(160, 216), (160, 240)], "fork", at=(185, 232))
    s.edge([(370, 216), (370, 240)], "HTTP + SSE", at=(410, 232))
    s.edge([(60, 150), (30, 150), (30, 62), (785, 62), (785, 125), (800, 125)], "HTTPS: OAuth token, Calendar, Tasks", at=(450, 66))
    s.edge([(470, 252), (495, 252), (495, 135), (510, 135)])
    s.edge([(470, 266), (775, 266), (775, 210), (800, 210)], "HTTPS", at=(640, 260))
    s.edge([(740, 150), (765, 150), (765, 195), (800, 195)], "", cls="d")
    s.edge([(800, 285), (790, 285), (790, 415), (160, 415), (160, 386)], "redirect /oauth2/callback", at=(470, 411))
    s.edge([(470, 296), (625, 296), (625, 430)], "file I/O", at=(625, 330))
    s.save(f"{OUT}/deployment.svg")


def workflow():
    s = SVG(1080, 150, "Development and merge workflow",
            "Feature branch, change with owning docs, local required checks, pull request, explicit user approval, merge, "
            "then delete the local branch and prune.")
    s.heading("Development workflow")
    steps = [("Feature branch", "from main"), ("Change + docs", "owning doc, diagrams"),
             ("Local checks", "typecheck, lint, test, build"), ("Pull request", "target main"),
             ("User approval", "explicit"), ("Merge, clean up", "branch -d, fetch --prune")]
    x = 20
    for i, (t, sub) in enumerate(steps):
        s.node(x, 64, 160, 56, t, sub)
        if i < len(steps) - 1:
            s.edge([(x + 160, 92), (x + 176, 92)])
        x += 176
    s.text(352, 140, "+ test:engine for core/opencode, test:routes for navigation · no GitHub Actions", "s")
    s.save(f"{OUT}/dev-workflow.svg")


component()
trust()
deployment()
workflow()
