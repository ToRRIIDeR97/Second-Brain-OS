const hours = [
  "8 AM",
  "9 AM",
  "10 AM",
  "11 AM",
  "12 PM",
  "1 PM",
  "2 PM",
  "3 PM",
  "4 PM",
  "5 PM",
];
const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function ReferenceCalendar({ compact = false }: { compact?: boolean }) {
  const today = new Date();
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <section
      className={`calendar-workspace${compact ? " calendar-workspace-compact" : ""}`}
      aria-labelledby="calendar-heading"
    >
      <header className="surface-toolbar">
        <div className="surface-title-row">
          <button type="button" className="button button-small">
            Today
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Previous week"
          >
            ‹
          </button>
          <button type="button" className="icon-button" aria-label="Next week">
            ›
          </button>
          <h1 id="calendar-heading">Week of {formatter.format(today)}</h1>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="button button-small">
            Week⌄
          </button>
          <button type="button" className="button button-small">
            Filter
          </button>
          <button type="button" className="button button-primary">
            New event
          </button>
        </div>
      </header>

      <div className="calendar-connection-notice" role="status">
        <span className="status-dot" /> Local calendar view
        <span>
          No calendar provider is connected, so external events are not shown.
        </span>
      </div>

      <div className="calendar-grid" aria-label="Weekly calendar">
        <div className="calendar-corner" />
        {days.map((day, index) => (
          <div className="calendar-day-heading" key={day}>
            <span>{day}</span>
            <strong>{today.getDate() + index}</strong>
          </div>
        ))}
        {hours.flatMap((hour) => [
          <div className="calendar-hour" key={`${hour}-label`}>
            {hour}
          </div>,
          ...days.map((day) => (
            <button
              type="button"
              className="calendar-cell"
              aria-label={`Add an event ${day} at ${hour}`}
              key={`${day}-${hour}`}
            />
          )),
        ])}
      </div>

      <footer className="calendar-assistant">
        <strong>Scheduling assistant</strong>
        <span>
          Connect a calendar to surface conflicts and focus-time suggestions.
        </span>
        <button type="button" className="button button-small" disabled>
          Connect calendar
        </button>
      </footer>
      <section
        className="calendar-google-tasks"
        aria-labelledby="google-tasks-title"
      >
        <div>
          <p className="eyebrow">Google Tasks</p>
          <h2 id="google-tasks-title">Task list</h2>
        </div>
        <p>
          No Google account is connected. Tasks will appear here after
          connection.
        </p>
        <button type="button" className="button button-small" disabled>
          Connect Google
        </button>
      </section>
    </section>
  );
}
