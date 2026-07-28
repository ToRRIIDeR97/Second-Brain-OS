import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalPlanner } from "./LocalPlanner";

describe("LocalPlanner", () => {
  it("creates and completes a local item with native form controls", () => {
    const onItemsChange = vi.fn();
    render(
      <LocalPlanner
        nowEpochSeconds={1_751_320_800}
        timezone="UTC"
        onItemsChange={onItemsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Write the handoff" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add locally" }));

    expect(screen.getByText("Write the handoff")).toBeInTheDocument();
    expect(onItemsChange).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Complete Write the handoff" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Reopen Write the handoff" }),
    ).toBeChecked();
  });

  it("supports date-only scheduling and keyboard view navigation", () => {
    render(<LocalPlanner nowEpochSeconds={1_751_320_800} timezone="UTC" />);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Review agenda" },
    });
    fireEvent.change(screen.getByLabelText("When"), {
      target: { value: "date" },
    });
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2025-06-30" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "Create local planner item" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Agenda/ }));
    expect(screen.getByText("Review agenda")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agenda/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
