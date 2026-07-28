import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import type { SearchResponse, SearchResult } from "./SearchWorkspace";

export type KnowledgeSearchModalProps = {
  /** Whether the modal is mounted and available to the user. */
  open: boolean;
  /** The latest response returned by the knowledge search provider. */
  response: SearchResponse;
  /** Called when the modal should be dismissed. */
  onClose: () => void;
  /** Called when the submitted query should be searched. */
  onSearch: (query: string) => void;
  /** Called when a result is selected. */
  onOpen: (result: SearchResult) => void;
  /** Optional query to show the first time the modal is rendered. */
  initialQuery?: string;
};

/**
 * A reusable, keyboard-friendly knowledge search surface.
 *
 * The backdrop and modal have deliberately specific class names so the host
 * shell can provide its own visual treatment (including blur) without making
 * this feature depend on shell CSS.
 */
export function KnowledgeSearchModal({
  open,
  response,
  onClose,
  onSearch,
  onOpen,
  initialQuery = "",
}: KnowledgeSearchModalProps) {
  const titleId = useId();
  const inputId = useId();
  const resultsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch(query);
  };

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      className="knowledge-search-backdrop backdrop-blur"
      data-testid="knowledge-search-backdrop"
      role="presentation"
      onClick={closeFromBackdrop}
    >
      <section
        className="knowledge-search-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="knowledge-search-header">
          <div>
            <p className="eyebrow">Knowledge</p>
            <h2 id={titleId}>Search knowledge</h2>
          </div>
          <button
            type="button"
            className="icon-button knowledge-search-close"
            aria-label="Close knowledge search"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className="knowledge-search-form" role="search" onSubmit={submit}>
          <label htmlFor={inputId}>Search knowledge</label>
          <div className="knowledge-search-controls">
            <input
              ref={inputRef}
              id={inputId}
              type="search"
              className="knowledge-search-input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search notes, decisions, and projects…"
              autoComplete="off"
              aria-controls={resultsId}
            />
            <button type="submit" className="button button-primary">
              Search
            </button>
          </div>
        </form>

        {response.error ? <p role="alert">{response.error}</p> : null}

        <ol
          id={resultsId}
          className="knowledge-search-results"
          aria-label="Knowledge search results"
        >
          {response.results.length ? (
            response.results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  className="knowledge-search-result"
                  onClick={() => {
                    onOpen(result);
                  }}
                >
                  <span className="knowledge-search-result-heading">
                    <strong>{result.title}</strong>
                    <small>{result.path}</small>
                  </span>
                  <span className="knowledge-search-result-snippet">
                    {result.snippet}
                  </span>
                  <small className="knowledge-search-result-meta">
                    {result.authority} · {result.indexState}
                    {result.project ? ` · ${result.project}` : ""}
                  </small>
                </button>
              </li>
            ))
          ) : (
            <li className="knowledge-search-empty">No matching knowledge.</li>
          )}
        </ol>
      </section>
    </div>
  );
}
