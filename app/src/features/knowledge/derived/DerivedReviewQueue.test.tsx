import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DerivedReviewQueue } from "./DerivedReviewQueue";
import type { DerivedArtifact } from "./types";

const artifact = (stale: boolean): DerivedArtifact => ({
  artifactId: "candidate-1",
  kind: "relationship_suggestion",
  text: "Decision A may support Project B",
  confidence: 740,
  status: "pending_review",
  stale,
  generator: {
    generator: "recorded",
    modelOrToolVersion: "model-1",
    promptVersion: "prompt-2",
  },
  dependencies: [{ sourceId: "document-1", sourceHash: "blake3:source" }],
});

describe("DerivedReviewQueue", () => {
  it("labels provenance and requires an explicit relationship decision", () => {
    const onReview = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <DerivedReviewQueue
        artifacts={[artifact(false)]}
        onReview={onReview}
        onRegenerate={onRegenerate}
      />,
    );

    expect(
      screen.getByText("Generated · not authoritative"),
    ).toBeInTheDocument();
    expect(screen.getByText(/confidence 740/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Provenance/));
    expect(screen.getByText(/blake3:source/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    expect(onReview).toHaveBeenCalledWith("candidate-1", "accepted");
  });

  it("blocks stale decisions but allows regeneration", () => {
    const onRegenerate = vi.fn();
    render(
      <DerivedReviewQueue
        artifacts={[artifact(true)]}
        onRegenerate={onRegenerate}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Stale");
    expect(screen.getByRole("button", { name: "Accepted" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate).toHaveBeenCalledWith("candidate-1");
  });
});
