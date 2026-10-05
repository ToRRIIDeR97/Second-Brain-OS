# Regenerate from the repository root: python3 docs/diagrams/generate/behavioral.py docs/diagrams
import sys
from svg import SVG, escape

OUT = sys.argv[1]


def klass(s, x, y, w, name, attrs, stereo=None, cls="box"):
    h = 30 + (14 if stereo else 0) + 15 * len(attrs) + 6
    s.raw(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="3"/>')
    ty = y + 18
    if stereo:
        s.text(x + w / 2, ty, f"«{stereo}»", "s", "middle")
        ty += 14
    s.text(x + w / 2, ty, name, "t", "middle")
    s.raw(f'<line class="e" x1="{x}" y1="{ty + 8}" x2="{x + w}" y2="{ty + 8}"/>')
    for i, a in enumerate(attrs):
        s.text(x + 8, ty + 24 + 15 * i, a, "s")
    return h


def assoc(s, pts, m1, m2, name=None, comp=False, at=None):
    s.edge(pts, head=None, tail="dm" if comp else None)

    def mult(a, b, m):
        (ax, ay), (bx, by) = a, b
        dx, dy = bx - ax, by - ay
        if abs(dx) > abs(dy):
            s.label(ax + (8 if dx > 0 else -8), ay - 5, m, "start" if dx > 0 else "end")
        else:
            s.label(ax + 6, ay + (14 if dy > 0 else -6), m, "start")
    mult(pts[0], pts[1], m1)
    mult(pts[-1], pts[-2], m2)
    if name:
        if at is None:
            i = len(pts) // 2
            at = ((pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2 - 6)
        s.label(at[0], at[1], name)


def classes():
    s = SVG(1080, 870, "Class view of core domain types",
            "UML class view: agent-runtime types (Project, Session, SessionMessage, SessionInput, durable Event, "
            "permission types, HarnessInstance) and Second Brain types (Location, BrainProject, KnowledgeNote, calendar).")
    s.heading("Class view", "UML 2.5.1 class diagram · filled diamond = composition · schema/src, core/src, opencode/src · fields abridged")
    klass(s, 20, 84, 230, "Project", ["id", "worktree", "directories[]"], "core table")
    klass(s, 280, 84, 230, "Event", ["aggregate_id = sessionID", "seq (unique per aggregate)", "type (versioned)"], "durable")
    klass(s, 540, 84, 230, "PermissionRule", ["action, resource (wildcards)", "effect: allow | ask | deny", "saved rows: allow only"])
    klass(s, 800, 84, 240, "Location", ["directory: AbsolutePath", "workspaceID?", "project {id, directory}"], "schema")
    klass(s, 20, 240, 230, "Session", ["id, projectID, workspaceID?", "directory, parentID?", "harnessInstanceID, harnessModel?",
                                       "harnessRevision", "harnessContinuation?"])
    klass(s, 280, 240, 230, "SessionMessage", ["seq (= durable event seq)", "User | Assistant | System |", "Shell | Synthetic | Compaction |",
                                              "AgentSwitched | ModelSwitched"], "union")
    klass(s, 540, 240, 230, "PermissionRequest", ["id per_…, sessionID", "action, resources[], save[]", "source? {messageID, callID}"], "in memory")
    klass(s, 800, 240, 240, "BrainProject", ["id project_<ULID>, name (unique)", "outcome, instructions", "status: active|paused|archived",
                                            "progressPercent 0..100", "location? {workspaceId, path}", "card: projects/<id>/project.md"])
    klass(s, 20, 470, 230, "SessionInput", ["id (= User message id)", "delivery: steer | queue", "admitted_seq, promoted_seq?"])
    klass(s, 280, 470, 230, "AssistantContent", ["Text | Reasoning | Tool", "Tool.state: ToolState", "snapshot {start, end, files}"])
    klass(s, 540, 470, 230, "HarnessInstance", ["id, driver: opencode|codex|acp", "status: available|unavailable", "models[]",
                                               "source: built-in | harnesses.json", "| config harnesses"])
    klass(s, 800, 470, 240, "KnowledgeNote", ["path notes/**.md or", "projects/<id>/notes/**.md", "title, tags[], links[]",
                                             "projectIds[]", "revision = sha256(raw)"])
    klass(s, 280, 690, 230, "Task", ["id, title, dueDate?, scheduledDate?", "completedAt? (open if unset)", "projectId?, source, syncState"])
    klass(s, 540, 690, 230, "CalendarEvent", ["id, title, date, start?/end?", "projectId?", "source: local | google, syncState"])
    klass(s, 800, 690, 240, "CalendarSnapshot", ["version 2, revision (ULID)", ".second-brain/calendar-v1.json", "events ≤ 5000, tasks ≤ 5000"])
    # agent runtime
    assoc(s, [(135, 179), (135, 240)], "1", "*", comp=True)
    assoc(s, [(250, 300), (280, 300)], "1", "*", comp=True)
    assoc(s, [(135, 351), (135, 470)], "1", "*", comp=True)
    assoc(s, [(215, 240), (215, 215), (395, 215), (395, 179)], "1", "*", "aggregate")
    assoc(s, [(395, 350), (395, 470)], "1", "*", comp=True)
    assoc(s, [(620, 335), (620, 420), (265, 420), (265, 335), (250, 335)], "*", "1")
    assoc(s, [(240, 351), (240, 445), (700, 445), (700, 470)], "*", "1", "bound via metadata")
    assoc(s, [(655, 84), (655, 74), (200, 74), (200, 84)], "*", "1", "saved per project", at=(560, 70))
    assoc(s, [(920, 84), (920, 64), (100, 64), (100, 84)], "1", "1", "resolves to", at=(700, 60))
    # second brain
    assoc(s, [(920, 179), (920, 240)], "1", "*")
    assoc(s, [(920, 470), (920, 366)], "*", "*", "projectIds")
    assoc(s, [(1040, 130), (1052, 130), (1052, 530), (1040, 530)], "1", "*")
    assoc(s, [(1040, 150), (1066, 150), (1066, 740), (1040, 740)], "1", "1")
    assoc(s, [(800, 740), (770, 740)], "1", "*", comp=True)
    assoc(s, [(920, 771), (920, 840), (395, 840), (395, 771)], "1", "*", comp=True)
    assoc(s, [(700, 690), (700, 615), (778, 615), (778, 330), (800, 330)], "*", "0..1", "projectId")
    assoc(s, [(450, 690), (450, 635), (790, 635), (790, 350), (800, 350)], "*", "0..1")
    s.save(f"{OUT}/class-domain.svg")


def activity_run():
    s = SVG(1000, 930, "Activity: prompt run",
            "UML activity for one prompt: admit input, wake the coordinator, promote inputs, stream from the selected "
            "harness, settle local tools through permissions, and finish or fail the step.")
    s.heading("Activity: prompt run", "core/src/session: SessionV2.prompt → SessionInput → run-coordinator → runner/llm.ts")
    cx = 500
    s.start(cx, 70)
    s.node(380, 92, 240, 34, "POST /api/session/:id/prompt")
    s.node(380, 144, 240, 44, "SessionInput.admit", "publish prompt.admitted")
    s.decision(cx, 220)
    s.node(380, 254, 240, 34, "coordinator.wake(sessionID)")
    s.decision(cx, 318)
    s.node(380, 352, 240, 44, "SessionRunner.run (drain)", "fail interrupted tools")
    s.node(380, 414, 240, 44, "promote steer / queue input", "publish session.next.prompted")
    s.node(380, 476, 240, 44, "build LLM request", "capture start snapshot")
    s.node(380, 538, 240, 44, "HarnessRuntime.stream", "opencode | codex | acp driver")
    s.node(380, 600, 240, 44, "publish LLM events", "text, reasoning, tool parts")
    s.decision(cx, 680)
    s.node(380, 716, 240, 44, "capture end snapshot", "publish step.ended")
    s.decision(cx, 792)
    s.final(cx, 860)
    # side
    s.node(680, 203, 200, 34, "409 PromptConflictError", cls="sub")
    s.node(680, 301, 200, 34, "set pendingWake; return", cls="sub")
    s.node(60, 663, 220, 44, "ToolRegistry.settle", "PermissionV2.assert")
    s.decision(170, 760)
    s.node(40, 806, 260, 44, "fail tools; interrupt drain", "user declined")
    s.node(700, 663, 200, 44, "fail unsettled tools", "publish step.failed")
    s.node(690, 440, 270, 70, "Interrupt (any time)", "turn/interrupt or session/cancel", cls="sub")
    s.text(825, 503, "→ unsettled tools fail, step.failed", "s", "middle")
    s.final(800, 780)
    s.edge([(800, 707), (800, 768)])
    s.final(170, 895)
    s.edge([(170, 850), (170, 883)])
    E = s.edge
    E([(cx, 78), (cx, 92)])
    E([(cx, 126), (cx, 144)])
    E([(cx, 188), (cx, 206)])
    E([(cx, 234), (cx, 254)], "[admitted]", at=(cx + 40, 247))
    E([(cx + 14, 220), (680, 220)], "[id reused, payload differs]", at=(597, 213))
    E([(cx, 288), (cx, 304)])
    E([(cx + 14, 318), (680, 318)], "[drain active]", at=(597, 311))
    E([(cx, 332), (cx, 352)], "[idle]", at=(cx + 26, 345))
    E([(cx, 396), (cx, 414)])
    E([(cx, 458), (cx, 476)])
    E([(cx, 520), (cx, 538)])
    E([(cx, 582), (cx, 600)])
    E([(cx, 644), (cx, 666)])
    E([(cx - 14, 680), (280, 685)], "[local tool call]", at=(330, 672))
    E([(cx + 14, 680), (700, 685)], "[provider error]", at=(600, 672))
    E([(cx, 694), (cx, 716)], "[finish]", at=(cx + 30, 708))
    E([(cx, 760), (cx, 778)])
    E([(cx, 806), (cx, 850)], "[no pending input]", at=(cx + 60, 830))
    E([(170, 707), (170, 746)])
    E([(170, 774), (170, 806)], "[deny / reject]", at=(225, 793))
    E([(156, 760), (20, 760), (20, 436), (380, 436)], "[allowed] needsContinuation", at=(120, 430))
    E([(cx - 14, 792), (330, 792), (330, 456), (380, 450)], "[steer pending / continuation]", at=(412, 786))
    s.save(f"{OUT}/activity-prompt-run.svg")


def activity_write():
    s = SVG(960, 930, "Activity: Second Brain write",
            "UML activity for PUT /second-brain/note and PUT /second-brain/calendar: authorization, workspace routing, "
            "decode, path containment, compare-and-swap write and best-effort timeline sync, with HTTP error exits.")
    s.heading("Activity: Second Brain write (note or calendar)",
              "opencode/src/server/routes/instance/httpapi/handlers/second-brain.ts · core/src/file-mutation.ts")
    cx, E = 440, s.edge

    def err(y, text):
        s.node(680, y - 15, 260, 30, text, cls="sub")

    s.start(cx, 70)
    E([(cx, 78), (cx, 92)])
    rows = [(92, "Authorization", "Basic auth (header or auth_token)", "[bad credentials]", "401"),
            (182, "WorkspaceRouting + InstanceContext", "directory → InstanceStore.load", "[invalid / unknown workspace]", "400 / 500"),
            (272, "decode query + payload", "schema layer", "[schema error]", "400"),
            (362, "resolve target path", "notePath rules · LocationMutation.resolve", "[escape · bad path · > 5 MiB]", "400")]
    for y, t, sub, guard, code in rows:
        s.node(cx - 150, y, 300, 44, t, sub)
        E([(cx, y + 44), (cx, y + 44 + 0.01)], head=None)
        s.decision(cx, y + 58)
        E([(cx + 14, y + 58), (680, y + 58)], guard, at=(580, y + 52))
        err(y + 58, code)
        E([(cx, y + 72), (cx, y + 90)])
    s.decision(cx, 466)
    E([(cx, 480), (cx, 500)], "[update]", at=(cx + 34, 494))
    s.node(cx - 150, 500, 300, 44, "read current file", "compare expectedRevision")
    s.decision(cx, 572)
    E([(cx, 544), (cx, 558)])
    E([(cx + 14, 572), (680, 572)], "[revision differs]", at=(580, 566))
    err(572, "409 stale")
    E([(cx, 586), (cx, 604)])
    s.node(cx - 150, 604, 300, 44, "validate + encode", "frontmatter / ULID revision")
    E([(cx, 648), (cx, 664)])
    s.node(cx - 150, 664, 300, 44, "FileMutation.writeIfUnchanged", "per-path mutex, compare bytes")
    s.decision(cx, 736)
    E([(cx, 708), (cx, 722)])
    E([(cx + 14, 736), (680, 736)], "[bytes changed]", at=(580, 730))
    err(736, "409 stale")
    # create branch
    E([(cx - 14, 466), (150, 466), (150, 560)], "[create flag / no calendar file]", at=(270, 459))
    s.node(20, 560, 250, 44, "FileMutation.create (flag wx)", "validate + encode first")
    s.decision(150, 640)
    E([(150, 604), (150, 626)])
    E([(136, 640), (70, 640), (70, 690)], "[exists]", at=(100, 634))
    s.node(10, 690, 150, 30, "409 exists", cls="sub")
    E([(164, 640), (275, 640), (275, 790), (cx - 14, 790)], "[created]", at=(310, 784))
    # merge + finish
    s.decision(cx, 790)
    E([(cx, 750), (cx, 776)], "[written]", at=(cx + 36, 768))
    E([(cx, 804), (cx, 822)])
    s.node(cx - 150, 822, 300, 44, "[calendar] BrainProject.syncTimelines", "best effort; errors swallowed")
    E([(cx, 866), (cx, 880)])
    s.final(cx, 892)
    s.text(cx + 20, 897, "200 Document / Snapshot", "s")
    s.box(680, 800, 270, 96, "Unverified at runtime", ["note/project validate() throws inside", "Effect.fn; handlers catch typed errors",
          "only, so these may surface as 500.", "CAS lock is process-local; no rename."], cls="gapz")
    s.save(f"{OUT}/activity-second-brain-write.svg")


classes()
activity_run()
activity_write()
