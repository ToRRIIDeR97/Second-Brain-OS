# Regenerate from the repository root: python3 docs/diagrams/generate/dynamic.py docs/diagrams
import sys
from svg import SVG

OUT = sys.argv[1]


def st(s, x, y, w, name, sub=None, h=None):
    h = h or (44 if sub else 34)
    s.node(x, y, w, h, name, sub, cls="box")


def states_session():
    s = SVG(1060, 640, "State machines: runs, inputs, tools and steps",
            "UML state machines for the run coordinator entry, prompt input rows, tool parts and assistant steps "
            "in the agent runtime.")
    s.heading("State machines: run execution", "UML 2.5.1 state machine diagrams · core/src/session, schema/src/session-message.ts")
    E = s.edge
    # A coordinator
    s.zone(20, 60, 500, 280, "Run coordinator entry · run-coordinator.ts")
    s.start(50, 140)
    st(s, 80, 123, 120, "Absent")
    st(s, 310, 123, 130, "Running", "owner drain fiber")
    st(s, 310, 260, 130, "Stopping")
    E([(58, 140), (80, 140)])
    E([(200, 132), (310, 132)], "run | wake / fork drain", at=(255, 126))
    E([(310, 158), (200, 158)], "drain exits [¬pendingWake]", at=(255, 174))
    E([(355, 123), (355, 96), (405, 96), (405, 123)], "wake / pendingWake = true", at=(380, 90))
    E([(440, 135), (480, 135), (480, 160), (440, 160)])
    s.label(400, 186, "exit [pendingWake,", "start")
    s.label(400, 199, "not stopping] /", "start")
    s.label(400, 212, "successor drain", "start")
    E([(335, 167), (335, 260)], "interrupt / pendingWake = false", at=(340, 240), lanchor="start")
    E([(310, 277), (140, 277), (140, 157)], "drain exits; waiters re-run", at=(225, 271))
    # B input
    s.zone(540, 60, 500, 280, "Prompt input row · session/input.ts")
    s.start(570, 142)
    st(s, 600, 120, 140, "Admitted", "promoted_seq NULL")
    st(s, 870, 120, 150, "Promoted", "promoted_seq set")
    st(s, 735, 250, 140, "Removed")
    s.final(990, 267)
    E([(578, 142), (600, 142)])
    E([(740, 142), (870, 142)], "prompted", at=(805, 136))
    s.label(805, 165, "[steer: at turn start]")
    s.label(805, 178, "[queue: no steer, no continuation]")
    E([(670, 164), (670, 267), (735, 267)], "revert.committed", at=(670, 215))
    E([(945, 164), (945, 230), (850, 230), (850, 250)], "revert.committed", at=(905, 224))
    E([(875, 267), (978, 267)])
    s.text(560, 320, "delivery: steer (default) | queue · reused id with a different payload → conflict", "s")
    # C tool
    s.zone(20, 360, 500, 260, "Tool part · ToolState")
    s.start(50, 437)
    st(s, 75, 420, 100, "pending")
    st(s, 215, 420, 100, "running")
    st(s, 365, 420, 120, "completed")
    st(s, 215, 540, 100, "error")
    E([(58, 437), (75, 437)])
    E([(175, 437), (215, 437)], "tool.called", at=(195, 412))
    E([(315, 437), (365, 437)], "tool.success", at=(340, 412))
    E([(125, 454), (125, 557), (215, 557)], "tool.failed", at=(165, 551))
    E([(265, 454), (265, 540)], "tool.failed · interrupted", at=(330, 500))
    s.text(40, 605, "input.started → pending · runner fails unsettled tools on error, interrupt and decline", "s")
    # D step
    s.zone(540, 360, 500, 260, "Assistant step · message-updater.ts")
    s.start(570, 477)
    st(s, 610, 455, 150, "Open", "time.completed unset")
    st(s, 860, 405, 150, "Completed", "finish, tokens, files")
    st(s, 860, 515, 150, "Failed", "finish = error")
    E([(578, 477), (610, 477)])
    s.label(685, 445, "step.started (closes previous open)")
    E([(760, 470), (810, 470), (810, 427), (860, 427)], "step.ended", at=(810, 418))
    E([(760, 490), (810, 490), (810, 537), (860, 537)], "step.failed", at=(810, 560))
    s.text(560, 605, "step.failed: provider error, interrupt, or user decline", "s")
    s.save(f"{OUT}/state-run.svg")


def states_platform():
    s = SVG(1060, 640, "State machines: permissions, sidecar, Google outbox and project status",
            "UML state machines for permission requests, the desktop sidecar process, Google write outbox operations "
            "and project status.")
    s.heading("State machines: permissions and platform", "UML 2.5.1 state machine diagrams · lifecycles are implicit unless an enum is named")
    E = s.edge
    # A permission
    s.zone(20, 60, 500, 280, "Permission request · core/src/permission.ts (in memory)")
    s.start(45, 160)
    s.decision(100, 160)
    st(s, 50, 240, 100, "Blocked")
    st(s, 250, 82, 110, "Allowed")
    st(s, 180, 165, 130, "Pending", "permission.v2.asked")
    st(s, 380, 120, 120, "Granted")
    st(s, 380, 220, 120, "Declined", "or Corrected")
    E([(53, 160), (86, 160)])
    E([(100, 174), (100, 240)], "[deny rule]", at=(132, 210))
    E([(100, 146), (100, 99), (250, 99)], "[allow, not alwaysAsk]", at=(106, 93), lanchor="start")
    E([(114, 160), (150, 160), (150, 187), (180, 187)], "[else]", at=(150, 154))
    E([(310, 180), (340, 180), (340, 137), (380, 137)], "reply once | always", at=(440, 112))
    E([(310, 200), (340, 200), (340, 245), (380, 245)], "reject · layer finalize", at=(395, 280))
    s.text(40, 310, "always: saves save[] as allow rules and grants other pending requests that now allow", "s")
    s.text(40, 326, "reject: declines other pending requests in the session; alwaysAsk ignores allow rules", "s")
    # B sidecar
    s.zone(540, 60, 500, 280, "Server sidecar (v1) · desktop/src/main/server.ts (implicit)")
    s.start(565, 125)
    st(s, 590, 108, 110, "Starting")
    st(s, 755, 108, 100, "Ready")
    st(s, 905, 108, 115, "Healthy")
    st(s, 590, 230, 110, "Failed")
    st(s, 790, 230, 110, "Stopping")
    s.final(980, 247)
    E([(573, 125), (590, 125)], "fork", at=(578, 100))
    E([(700, 125), (755, 125)], "ready", at=(727, 119))
    E([(855, 125), (905, 125)], "health ok", at=(880, 119))
    E([(645, 142), (645, 230)], "error · exit · 60 s", at=(645, 195))
    E([(805, 142), (805, 230)], "stop", at=(822, 190))
    E([(962, 142), (962, 190), (870, 190), (870, 230)])
    E([(900, 247), (968, 247)], "exit | kill 6 s", at=(934, 241))
    s.text(560, 305, "Failed: renderer shows the local-server error; no automatic retry.", "s")
    s.text(560, 321, "Health timeout (30 s) after Ready is only logged.", "s")
    # C outbox
    s.zone(20, 360, 500, 260, "Google write outbox operation · google-calendar.ts")
    s.start(45, 458)
    st(s, 70, 440, 100, "pending")
    st(s, 300, 395, 120, "succeeded")
    st(s, 300, 440, 120, "conflict")
    st(s, 300, 485, 120, "failed")
    st(s, 300, 530, 120, "offline")
    E([(53, 458), (70, 458)])
    E([(170, 450), (210, 450), (210, 412), (300, 412)], "2xx", at=(255, 406))
    E([(170, 457), (300, 457)], "412", at=(255, 451))
    E([(170, 464), (210, 464), (210, 502), (300, 502)], "HTTP error", at=(255, 496))
    E([(210, 502), (210, 547), (300, 547)], "other error", at=(255, 541))
    E([(360, 564), (360, 585), (120, 585), (120, 474)], "sync() retries pending | offline", at=(240, 580))
    s.text(40, 610, "dispatch increments attempts · idempotencyKey dedupes · last 100 kept", "s")
    # D project status
    s.zone(540, 360, 500, 260, "Project status · opencode/src/project/brain.ts")
    s.start(565, 437)
    st(s, 590, 420, 110, "active")
    st(s, 750, 420, 110, "paused")
    st(s, 910, 420, 110, "archived")
    E([(573, 437), (590, 437)])
    E([(700, 430), (750, 430)], head="a")
    E([(750, 445), (700, 445)], head="a")
    E([(860, 430), (910, 430)], head="a")
    E([(910, 445), (860, 445)], head="a")
    E([(645, 454), (645, 485), (965, 485), (965, 454)], "update(status) — unguarded, any direction", at=(805, 480), tail="a")
    s.text(560, 530, "Calendar syncState: local | pending | synced | offline | stale | conflict | failed", "s")
    s.text(560, 546, "has invariants only (source=local ⇔ local; synced has no outboxKey);", "s")
    s.text(560, 562, "no transition function. Task is open until completedAt is set.", "s")
    s.save(f"{OUT}/state-platform.svg")


def seq_startup():
    s = SVG(900, 800, "Sequence: desktop startup",
            "UML sequence for desktop startup: Electron main launches the bundled server in a utility process, waits "
            "for ready, hands credentials to the renderer through preload IPC, with the startup failure path and shutdown.")
    s.heading("Sequence: desktop startup and shutdown", "desktop/src/main/index.ts · server.ts · sidecar.ts · renderer/index.tsx")
    M, L, S, R = 110, 320, 530, 760
    s.lifelines([("Electron main", M, "index.ts"), ("Server launcher", L, "server.ts"),
                 ("OpenCode server", S, "utility process"), ("Renderer", R, "preload + app")], 64, 780, w=170)
    s.msg(M, M, 124, "single-instance lock · preferAppEnv")
    s.msg(M, M, 160, "whenReady: migrate, IPC, Google service")
    s.msg(M, L, 210, "spawnLocalServer(127.0.0.1, port, uuid)")
    s.msg(L, S, 245, "utilityProcess.fork · {type: start}")
    s.msg(S, S, 270, "Server.listen (Basic auth, CORS)")
    s.msg(S, L, 316, "ready", reply=True)
    s.msg(L, M, 346, "serverReady ← {url, username, password}", reply=True)
    s.frag(40, 366, 820, 92, "alt", "[error · exit before ready · 60 s stall]")
    s.msg(L, S, 405, "kill child")
    s.msg(L, M, 440, "serverReady fails (no retry)", reply=True)
    s.msg(L, S, 488, "poll GET /api/health every 100 ms, ≤ 30 s (failure only logged)")
    s.msg(M, R, 528, "restoreMainWindows → oc://renderer")
    s.msg(R, M, 566, "invoke await-initialization")
    s.msg(M, R, 600, "{url, username, password} | rejection → error page", reply=True)
    s.msg(R, S, 640, "GET /api/health, /global/health (capabilities)")
    s.msg(R, S, 674, "SSE /global/event · bootstrap queries")
    s.frag(40, 694, 820, 76, "opt", "[before-quit · will-quit · SIGTERM]")
    s.msg(M, S, 735, "{type: stop} · kill after 6 s · drafts flush/close")
    s.save(f"{OUT}/sequence-startup.svg")


def seq_acp():
    s = SVG(1100, 1010, "Sequence: ACP harness turn with permission",
            "UML sequence for one Run turn through an ACP harness: prompt admission, drain, runtime open with session "
            "load or new, streaming updates, a permission request answered in the renderer, completion and interrupt.")
    s.heading("Sequence: ACP harness turn with permission", "core/src/session.ts · runner/llm.ts · harness.ts · harness/acp.ts · permission.ts")
    R, V, N, H, A, G, P = 80, 235, 390, 545, 700, 860, 1015
    s.lifelines([("Renderer", R, None), ("SessionV2", V, None), ("SessionRunner", N, None), ("HarnessRuntime", H, None),
                 ("AcpHarness", A, None), ("ACP agent", G, "child process"), ("PermissionV2", P, None)], 64, 990, w=140)
    s.msg(R, V, 124, "POST /api/session/:id/prompt")
    s.msg(V, V, 140, "admit → prompt.admitted")
    s.msg(V, N, 190, "coordinator.wake → drain")
    s.msg(N, N, 206, "promote input · start snapshot")
    s.msg(N, H, 256, "stream(instanceID, revision)")
    s.frag(470, 274, 520, 140, "opt", "[no cached runtime]")
    s.msg(H, A, 318, "open(command, continuation)")
    s.msg(A, G, 346, "spawn · initialize (no fs/terminal)")
    s.msg(A, G, 374, "session/load [continuation] else session/new")
    s.msg(H, H, 386, "harness.continuation.set")
    s.msg(A, G, 446, "session/prompt (handoff transcript if new)")
    s.msg(G, A, 478, "session/update chunks", reply=True)
    s.msg(A, N, 508, "LLM events (stream)", reply=True)
    s.msg(N, R, 538, "durable events → SSE /global/event", reply=True)
    s.msg(G, A, 578, "session/request_permission")
    s.msg(A, P, 608, "approve → assert(action, resources)")
    s.frag(40, 626, 1030, 94, "alt", "[rule = ask]")
    s.msg(P, R, 660, "permission.v2.asked (SSE)", reply=True)
    s.msg(R, P, 694, "POST …/permission/:requestID/reply once | always | reject")
    s.msg(P, A, 746, "allowed | denied", reply=True)
    s.msg(A, G, 776, "outcome: selected optionId")
    s.msg(G, A, 808, "prompt result (stopReason)", reply=True)
    s.msg(A, N, 838, "step-finish · finish", reply=True)
    s.msg(N, N, 852, "end snapshot · step.ended")
    s.frag(40, 892, 1030, 86, "opt", "[user interrupts]")
    s.msg(R, V, 930, "POST …/interrupt")
    s.msg(V, N, 946, "coordinator.interrupt")
    s.msg(A, G, 962, "session/cancel (runtime stays cached)")
    s.save(f"{OUT}/sequence-acp-turn.svg")


states_session()
states_platform()
seq_startup()
seq_acp()
