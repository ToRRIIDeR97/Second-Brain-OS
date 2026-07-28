import { describe, expect, it } from "vitest";
import {
  LocalPlannerStore,
  localDateForEpoch,
  PlannerValidationError,
} from "./local";

describe("LocalPlannerStore", () => {
  it("keeps date-only and exact schedules distinct across a timezone boundary", () => {
    const store = new LocalPlannerStore([], 1_751_320_800);
    store.create({
      title: "date",
      schedule: { kind: "date_only", date: "2025-07-01" },
    });
    store.create({
      title: "exact",
      schedule: {
        kind: "exact",
        startEpochSeconds: 1_751_320_800,
        timezone: "+02:00",
      },
    });
    const groups = store.groups(1_751_320_800, "+02:00");
    expect(groups.today.map((item) => item.title)).toEqual(["date", "exact"]);
    expect(groups.agenda).toHaveLength(2);
  });

  it("reconciles an explicit task id instead of duplicating it", () => {
    const store = new LocalPlannerStore();
    const first = store.reconcileExplicitTask("ship", {
      title: "Old title",
      sourceLink: { workspaceId: "ws", relativePath: "notes/today.md" },
    });
    const second = store.reconcileExplicitTask("ship", {
      title: "New title",
      sourceLink: { workspaceId: "ws", relativePath: "notes/today.md" },
    });
    expect(first.kind).toBe("created");
    expect(second.kind).toBe("updated");
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.title).toBe("New title");
  });

  it("rejects duplicate explicit ids and keeps archive out of views", () => {
    const store = new LocalPlannerStore();
    store.create({
      title: "one",
      sourceLink: {
        workspaceId: "ws",
        relativePath: "one.md",
        explicitTaskId: "same",
      },
    });
    expect(() =>
      store.create({
        title: "two",
        sourceLink: {
          workspaceId: "ws",
          relativePath: "two.md",
          explicitTaskId: "same",
        },
      }),
    ).toThrow(PlannerValidationError);
    const second = store.create({ title: "two" });
    store.archive(second.id);
    expect(store.groups().unscheduled.map((item) => item.title)).toEqual([
      "one",
    ]);
  });

  it("uses deterministic offset math for exact dates", () => {
    expect(localDateForEpoch(0, "+14:00")).toBe("1970-01-01");
    expect(localDateForEpoch(0, "-12:00")).toBe("1969-12-31");
  });
});
