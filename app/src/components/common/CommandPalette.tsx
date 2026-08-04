import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type {
  AppCommand,
  CommandContext,
  CommandRegistry,
} from "../../app/commands";

type Props = {
  open: boolean;
  registry: CommandRegistry;
  context: CommandContext;
  onClose: () => void;
};

export function CommandPalette({ open, registry, context, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const commands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return registry
      .list(context)
      .filter(
        (command) =>
          !normalized ||
          `${command.title} ${command.category}`
            .toLowerCase()
            .includes(normalized),
      );
  }, [context, query, registry]);

  useEffect(() => {
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
  const run = (command: AppCommand | undefined) => {
    if (!command) return;
    void registry.execute(command.id, context);
    onClose();
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={panelRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="palette-heading">
          <p className="eyebrow" id="command-palette-title">
            Command palette
          </p>
          <button
            type="button"
            className="icon-button"
            aria-label="Close command palette"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) =>
                Math.min(index + 1, Math.max(0, commands.length - 1)),
              );
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              run(commands[activeIndex]);
            }
          }}
          placeholder="Search commands…"
          aria-label="Search commands"
        />
        <ul className="command-list" role="listbox" aria-label="Commands">
          {commands.length ? (
            commands.map((command, index) => (
              <li
                key={command.id}
                role="option"
                aria-selected={index === activeIndex}
              >
                <button
                  type="button"
                  className="command-option"
                  onMouseEnter={() => {
                    setActiveIndex(index);
                  }}
                  onClick={() => {
                    run(command);
                  }}
                >
                  <span>
                    <strong>{command.title}</strong>
                    <small>
                      {command.category} · {command.permission}
                    </small>
                  </span>
                  {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                </button>
              </li>
            ))
          ) : (
            <li className="command-empty">No matching commands.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
