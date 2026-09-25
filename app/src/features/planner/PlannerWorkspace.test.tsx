import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMockIpc } from "../../lib/ipc/mock";
import type { PlannerItemRecord } from "../../lib/ipc";
import { PlannerWorkspace } from "./PlannerWorkspace";

function today() {
  const date = new Date();
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function item(overrides: Partial<PlannerItemRecord> = {}): PlannerItemRecord {
  return {
    id: "planner_alpha",
    kind: "task",
    title: "Review the control center",
    schedule: { kind: "date_only", date: today() },
    status: "open",
    source: "local",
    syncStatus: "local_only",
    createdAtEpochSeconds: 10,
    updatedAtEpochSeconds: 10,
    ...overrides,
  };
}

function success<T>(data: T) {
  return {
    contract: "ipc_result",
    version: 1,
    ok: true,
    data,
    correlationId: "test-correlation",
  } as const;
}

describe("PlannerWorkspace", () => {
  it("opens calendar details from Today", async () => {
    const mock = createMockIpc();
    mock.setResponse(
      "planner_list",
      success([
        item({
          id: "event_one",
          kind: "calendar",
          title: "Design review",
          location: "Marina Bay Sands, Singapore",
          schedule: { kind: "all_day", date: today() },
          source: "provider",
          providerLink: {
            provider: "google",
            objectId: "calendar:primary:event",
          },
          syncStatus: "synced",
        }),
      ]),
    );
    render(<PlannerWorkspace ipc={mock.client} brainWorkspaceId="brain" />);

    expect(
      await screen.findByRole("button", { name: /Design review/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Agenda" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/managed (by|in) google/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Design review/ }));
    expect(screen.getByRole("dialog", { name: "Event details" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Design review" }),
    ).toBeVisible();
    expect(
      screen.getByTitle("Map of Marina Bay Sands, Singapore"),
    ).toHaveAttribute("src", expect.stringContaining("google.com/maps"));
    expect(screen.queryByText("Synced with Google")).not.toBeInTheDocument();
  });

  it("keeps loaded calendar data while typing", async () => {
    const mock = createMockIpc();
    mock.setResponse(
      "planner_list",
      success([
        item({
          id: "event_exact",
          kind: "calendar",
          title: "Timed review",
          schedule: {
            kind: "exact",
            startEpochSeconds: Math.floor(Date.now() / 1_000),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
      ]),
    );
    render(<PlannerWorkspace ipc={mock.client} brainWorkspaceId="brain" />);
    await screen.findByRole("button", { name: /Timed review/ });

    fireEvent.change(screen.getByLabelText("New event"), {
      target: { value: "Draft" },
    });

    expect(screen.getByRole("button", { name: /Timed review/ })).toBeVisible();
    expect(
      mock.calls.filter(({ command }) => command === "planner_list"),
    ).toHaveLength(1);

    const firstRequest = mock.calls.find(
      ({ command }) => command === "planner_list",
    )?.args?.request as { range?: { startDate: string } };
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => {
      expect(
        mock.calls.filter(({ command }) => command === "planner_list"),
      ).toHaveLength(2);
    });
    const secondRequest = mock.calls.filter(
      ({ command }) => command === "planner_list",
    )[1]?.args?.request as { range?: { startDate: string } };
    expect(secondRequest.range?.startDate).not.toBe(
      firstRequest.range?.startDate,
    );
  });

  it("deduplicates the development Strict Mode load", async () => {
    const mock = createMockIpc();
    mock.setResponse("planner_list", success([]));

    render(
      <StrictMode>
        <PlannerWorkspace ipc={mock.client} brainWorkspaceId="brain" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(
        mock.calls.filter(({ command }) => command === "planner_list"),
      ).toHaveLength(1);
    });
  });

  it("creates a local task when Google write access is unavailable", async () => {
    const mock = createMockIpc();
    const created = item({ id: "planner_created", title: "Write the plan" });
    mock.setResponse("planner_list", success([]));
    mock.setResponse("planner_create", success(created));
    render(
      <PlannerWorkspace
        ipc={mock.client}
        brainWorkspaceId="brain"
        initialView="tasks"
      />,
    );

    fireEvent.change(await screen.findByLabelText("New task"), {
      target: { value: "Write the plan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => {
      expect(
        mock.calls.some(({ command }) => command === "planner_create"),
      ).toBe(true);
    });
    expect(
      mock.calls.find(({ command }) => command === "planner_create"),
    ).toEqual({
      command: "planner_create",
      args: {
        request: {
          brainWorkspaceId: "brain",
          draft: { kind: "task", title: "Write the plan" },
          syncTarget: "local",
        },
      },
    });
  });

  it("creates, completes, edits, and deletes Google tasks through planner commands", async () => {
    const mock = createMockIpc();
    const googleTask = item({
      id: "planner_google",
      title: "Google review",
      source: "provider",
      providerLink: { provider: "google", objectId: "tasks:list:task" },
      syncStatus: "synced",
    });
    mock.setResponse("planner_list", success([googleTask]));
    mock.setResponse(
      "google_connection_status_get",
      success({
        state: "connected",
        connected: true,
        clientSecretConfigured: true,
        consentMode: "read_write",
        calendarEnabled: true,
        tasksEnabled: true,
        lastSyncedAt: "2026-08-22T01:00:00Z",
        message: "Google is connected.",
      }),
    );
    mock.setResponse(
      "planner_update",
      success({ ...googleTask, status: "completed" }),
    );
    mock.setResponse("planner_delete", success(null));
    render(
      <PlannerWorkspace
        ipc={mock.client}
        brainWorkspaceId="brain"
        initialView="tasks"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Complete Google review" }),
    );
    await waitFor(() => {
      expect(
        mock.calls.some(({ command }) => command === "planner_update"),
      ).toBe(true);
    });

    const googleTaskButton = screen
      .getByText("Google review")
      .closest("button");
    expect(googleTaskButton).not.toBeNull();
    if (googleTaskButton) fireEvent.click(googleTaskButton);
    expect(screen.getByRole("dialog", { name: "Task" })).toBeVisible();
    mock.setResponse(
      "planner_update",
      success({ ...googleTask, title: "Renamed review", status: "completed" }),
    );
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Renamed review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(
        mock.calls.filter(({ command }) => command === "planner_update"),
      ).toHaveLength(2);
    });

    const renamedTaskButton = screen
      .getByText("Renamed review")
      .closest("button");
    expect(renamedTaskButton).not.toBeNull();
    if (renamedTaskButton) fireEvent.click(renamedTaskButton);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    const confirmDeleteButton = deleteButtons.at(-1);
    expect(confirmDeleteButton).toBeDefined();
    if (confirmDeleteButton) fireEvent.click(confirmDeleteButton);

    await waitFor(() => {
      expect(
        mock.calls.some(({ command }) => command === "planner_delete"),
      ).toBe(true);
    });
  });

  it("keeps a failed load actionable", async () => {
    const mock = createMockIpc();
    mock.setResponse("planner_list", {
      contract: "ipc_result",
      version: 1,
      ok: false,
      error: {
        code: "planner.unavailable",
        message: "Local planner is unavailable.",
        retryable: true,
      },
      correlationId: "failure",
    });
    render(<PlannerWorkspace ipc={mock.client} brainWorkspaceId="brain" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Local planner is unavailable.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(
        mock.calls.filter(({ command }) => command === "planner_list"),
      ).toHaveLength(2);
    });
  });
});
