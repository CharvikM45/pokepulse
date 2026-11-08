"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  RefObject,
} from "react";

/** Hydration-safe clock; time-sensitive views refresh from an external timer. */
export function useNow(interval = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [interval]);
  return now;
}

export function Button({
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <button
      type="button"
      {...props}
      data-variant={variant}
      className={`pp-button ${props.className ?? ""}`}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`pp-input ${props.className ?? ""}`} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  id,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid": boolean;
  }) => ReactNode;
}) {
  const described =
    [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className="pp-field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <small id={`${id}-hint`} className="pp-muted">
          {hint}
        </small>
      )}
      {children({
        id,
        "aria-describedby": described,
        "aria-invalid": Boolean(error),
      })}
      {error && (
        <p id={`${id}-error`} className="pp-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "danger";
}) {
  return (
    <span className="pp-status" data-tone={tone}>
      <span aria-hidden="true">
        {tone === "info" ? "●" : tone === "warning" ? "△" : "!"}
      </span>
      {children}
    </span>
  );
}

export function StateCard({
  title,
  children,
  retry,
  error = false,
}: {
  title: string;
  children: ReactNode;
  retry?: () => void;
  error?: boolean;
}) {
  return (
    <section className="pp-card" role={error ? "alert" : undefined}>
      <h2>{title}</h2>
      <p>{children}</p>
      {retry && <Button onClick={retry}>Try again</Button>}
    </section>
  );
}

export function Skeleton({ label = "Loading results" }: { label?: string }) {
  return (
    <div role="status">
      <span className="pp-sr-only">{label}</span>
      <div className="pp-skeleton" aria-hidden="true" />
    </div>
  );
}

export function Pagination({
  previous,
  next,
  summary,
}: {
  previous?: string;
  next?: string;
  summary: string;
}) {
  return (
    <nav className="pp-row" aria-label="Results pages">
      {previous ? (
        <a href={previous}>Previous page</a>
      ) : (
        <span>Previous page unavailable</span>
      )}
      <span>{summary}</span>
      {next ? <a href={next}>Next page</a> : <span>Next page unavailable</span>}
    </nav>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly { id: string; label: string; content: ReactNode }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const prefix = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div>
      <div className="pp-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="pp-button"
            data-variant="secondary"
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            id={`${prefix}-tab-${tab.id}`}
            aria-controls={`${prefix}-panel-${tab.id}`}
            aria-selected={value === tab.id}
            tabIndex={value === tab.id ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              let target: number | undefined;
              if (event.key === "ArrowRight")
                target = (index + 1) % tabs.length;
              if (event.key === "ArrowLeft")
                target = (index + tabs.length - 1) % tabs.length;
              if (event.key === "Home") target = 0;
              if (event.key === "End") target = tabs.length - 1;
              if (target !== undefined) {
                event.preventDefault();
                tabRefs.current[target]?.focus();
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <section
          key={tab.id}
          role="tabpanel"
          tabIndex={0}
          id={`${prefix}-panel-${tab.id}`}
          aria-labelledby={`${prefix}-tab-${tab.id}`}
          hidden={tab.id !== value}
        >
          {tab.content}
        </section>
      ))}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  restoreFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  restoreFocusTo?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    const returnFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      // The caller can choose a new destination after an asynchronous save.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const target = restoreFocusTo?.current ?? returnFocus;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [open, restoreFocusTo]);
  return (
    <dialog
      ref={ref}
      className="pp-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <Button variant="secondary" autoFocus onClick={onClose}>
        Cancel
      </Button>
      {children}
    </dialog>
  );
}

export function ToastRegion({
  message,
  dismiss,
}: {
  message: string | null;
  dismiss: () => void;
}) {
  return (
    <div className="pp-toast">
      <div role="status" aria-live="polite" aria-atomic="true">
        {message && (
          <div className="pp-card">
            <p>{message}</p>
            <Button variant="secondary" onClick={dismiss}>
              Dismiss notification
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export interface ComboOption {
  value: string;
  label: string;
}
export function SearchCombobox({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly ComboOption[];
  value: string | null;
  onChange: (value: string) => void;
  label: string;
}) {
  const id = useId();
  const selected =
    options.find((option) => option.value === value)?.label ?? "";
  const [query, setQuery] = useState(selected);
  const [lastSelected, setLastSelected] = useState(selected);
  if (lastSelected !== selected) {
    setLastSelected(selected);
    setQuery(selected);
  }
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const filtered = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const current = filtered.length ? Math.min(active, filtered.length - 1) : -1;
  useEffect(() => {
    if (open && current >= 0)
      optionRefs.current[current]?.scrollIntoView({ block: "nearest" });
  }, [current, open]);
  function choose(option: ComboOption) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  }
  return (
    <div className="pp-field pp-combobox">
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        role="combobox"
        autoComplete="off"
        value={query}
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={`${id}-options`}
        aria-activedescendant={
          open && current >= 0
            ? `${id}-option-${filtered[current].value}`
            : undefined
        }
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery(selected);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setQuery(selected);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive(
              !open
                ? event.key === "ArrowDown"
                  ? 0
                  : Math.max(0, filtered.length - 1)
                : Math.max(
                    0,
                    Math.min(
                      filtered.length - 1,
                      current + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
            );
          }
          if (open && event.key === "Home") {
            event.preventDefault();
            setActive(0);
          }
          if (open && event.key === "End") {
            event.preventDefault();
            setActive(Math.max(0, filtered.length - 1));
          }
          if (open && event.key === "Enter" && current >= 0) {
            event.preventDefault();
            choose(filtered[current]);
          }
        }}
      />
      <ul
        id={`${id}-options`}
        role="listbox"
        aria-label={`${label} options`}
        className="pp-options"
        hidden={!open}
      >
        {filtered.map((option, index) => (
          <li
            key={option.value}
            role="option"
            id={`${id}-option-${option.value}`}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            aria-selected={value === option.value}
            data-active={current === index}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
          >
            {option.label}
          </li>
        ))}
      </ul>
      {open && !filtered.length && (
        <span role="status">No matching options</span>
      )}
    </div>
  );
}
