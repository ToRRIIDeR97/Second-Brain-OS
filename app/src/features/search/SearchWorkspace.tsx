import { useState, type SyntheticEvent } from "react";

export type SearchResult = {
  id: string;
  title: string;
  path: string;
  snippet: string;
  authority: string;
  indexState: "current" | "stale" | "failed";
  project?: string;
  reasonCodes: string[];
};

export type SearchResponse = {
  results: SearchResult[];
  structuredPlan: string;
  nextCursor?: string;
  error?: string;
};

export function SearchWorkspace({
  response,
  onSearch,
  onOpen,
}: {
  response: SearchResponse;
  onSearch: (query: string) => void;
  onOpen: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch(query);
  };

  return (
    <section aria-labelledby="search-title">
      <h1 id="search-title">Search knowledge</h1>
      <form role="search" onSubmit={submit}>
        <label>
          Query
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder='type:decision project:"Agent OS" SQLite'
          />
        </label>
        <button type="submit">Search</button>
      </form>
      {response.error ? <p role="alert">{response.error}</p> : null}
      <details>
        <summary>Structured plan</summary>
        <pre>{response.structuredPlan || "No query submitted."}</pre>
      </details>
      <ol aria-label="Search results">
        {response.results.map((result) => (
          <li key={result.id}>
            <button
              type="button"
              onClick={() => {
                onOpen(result);
              }}
            >
              <strong>{result.title}</strong>
              <span>{result.path}</span>
              <span>{result.snippet}</span>
              <small>
                {result.authority} · {result.indexState}
                {result.project ? ` · ${result.project}` : ""}
              </small>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
