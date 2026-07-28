export type DerivedReviewStatus =
  | "pending_review"
  | "accepted"
  | "rejected"
  | "dismissed";

export type DerivedArtifact = {
  artifactId: string;
  kind:
    | "document_summary"
    | "project_summary"
    | "area_summary"
    | "claim"
    | "contradiction"
    | "duplicate"
    | "concept"
    | "relationship_suggestion";
  text: string;
  confidence: number;
  status: DerivedReviewStatus;
  stale: boolean;
  generator: {
    generator: string;
    modelOrToolVersion: string;
    promptVersion: string;
  };
  dependencies: { sourceId: string; sourceHash: string }[];
};
