import type { DerivedArtifact, DerivedReviewStatus } from "./types";

export function DerivedReviewQueue({
  artifacts,
  onReview,
  onRegenerate,
}: {
  artifacts: DerivedArtifact[];
  onReview?: (artifactId: string, status: DerivedReviewStatus) => void;
  onRegenerate?: (artifactId: string) => void;
}) {
  return (
    <section aria-labelledby="derived-review-title">
      <p className="eyebrow">Generated · not authoritative</p>
      <h1 id="derived-review-title">Derived review</h1>
      {artifacts.length === 0 ? (
        <p>No derived artifacts need review.</p>
      ) : (
        <ul aria-label="Derived artifacts">
          {artifacts.map((artifact) => (
            <li
              key={artifact.artifactId}
              data-authority="derived"
              aria-label={`${artifact.kind.replaceAll("_", " ")}: ${artifact.text}`}
            >
              <strong>{artifact.kind.replaceAll("_", " ")}</strong>
              <p>{artifact.text}</p>
              <p role="status">
                {artifact.stale ? "Stale · sources changed" : artifact.status} ·
                confidence {artifact.confidence}/1000
              </p>
              <small>
                {artifact.generator.generator} ·{" "}
                {artifact.generator.modelOrToolVersion} · prompt{" "}
                {artifact.generator.promptVersion}
              </small>
              <details>
                <summary>Provenance ({artifact.dependencies.length})</summary>
                <ul>
                  {artifact.dependencies.map((source) => (
                    <li key={source.sourceId}>
                      {source.sourceId} · {source.sourceHash}
                    </li>
                  ))}
                </ul>
              </details>
              {(["accepted", "rejected", "dismissed"] as const).map(
                (status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={artifact.stale}
                    onClick={() => onReview?.(artifact.artifactId, status)}
                  >
                    {status[0]?.toUpperCase()}
                    {status.slice(1)}
                  </button>
                ),
              )}
              <button
                type="button"
                onClick={() => onRegenerate?.(artifact.artifactId)}
              >
                Regenerate
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
