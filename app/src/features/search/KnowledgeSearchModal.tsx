import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import { X } from "lucide-react";
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
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          "input, button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setActiveIndex(response.results.length ? 0 : -1);
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
        ref={panelRef}
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
            <X size={16} aria-hidden="true" />
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
                setActiveIndex(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && response.results.length) {
                  event.preventDefault();
                  setActiveIndex(0);
                  resultRefs.current[0]?.focus();
                }
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
            response.results.map((result, index) => (
              <li key={result.id}>
                <button
                  ref={(element) => {
                    resultRefs.current[index] = element;
                  }}
                  type="button"
                  className="knowledge-search-result"
                  aria-current={activeIndex === index || undefined}
                  onFocus={() => {
                    setActiveIndex(index);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
                      return;
                    event.preventDefault();
                    const next =
                      event.key === "ArrowDown"
                        ? (index + 1) % response.results.length
                        : (index - 1 + response.results.length) %
                          response.results.length;
                    setActiveIndex(next);
                    resultRefs.current[next]?.focus();
                  }}
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
            <li className="knowledge-search-empty">
              {submitted
                ? "No matching knowledge. Try a broader phrase."
                : "Search notes, decisions, projects, and indexed files."}
            </li>
          )}
        </ol>
      </section>
    </div>
  );
}
