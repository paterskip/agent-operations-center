"use client";

import { useMemo, useState } from "react";
import { summarizeBody, type TaskSection } from "@/lib/body-summary";

/** Bezpieczne formatowanie prostych znaczników Markdown w linijce (pogrubienie, inline code). */
function renderInlineMarkdown(text: string) {
  // Rozdzielamy po elementach `code` lub **bold**
  const parts: (string | React.ReactNode)[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length ? parts : text;
}

/** Renderuje treść sekcji specyfikacji PM. */
function SectionBlock({ section }: { section: TaskSection }) {
  const isList = section.lines.some((l) => /^[-*•)\d.]+\s/.test(l.trim()));
  const items = section.lines.map((l) => l.trim()).filter(Boolean);

  return (
    <div className="task-spec-section">
      <h4 className="task-spec-heading">{section.heading}</h4>
      {isList ? (
        <ul className="task-spec-list">
          {items.map((item, idx) => {
            const clean = item.replace(/^[-*•)\d.]+\s*(?:\[[ xX]\]\s*)?/, "").trim();
            const isChecked = /^[-*•]\s*\[[xX]\]/.test(item);
            return (
              <li key={idx} className={isChecked ? "checked" : ""}>
                <span className="spec-bullet">{isChecked ? "✓" : "•"}</span>
                <span>{renderInlineMarkdown(clean)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="task-spec-text">
          {items.map((line, idx) => (
            <p key={idx}>{renderInlineMarkdown(line)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ustrukturyzowany opis zadania: Cel + Kryteria sukcesu + Pełna specyfikacja PM. */
export function TaskBody({ body }: { body: string | null }) {
  const [open, setOpen] = useState(false);
  const { goal, criteria, sections, full, isLong } = useMemo(() => summarizeBody(body), [body]);

  return (
    <div className="task-body">
      {/* 1. Wyróżniony Cel */}
      <div className="task-goal-box">
        <span className="task-goal-badge">CEL ZADANIA</span>
        <p className="task-goal-text">{renderInlineMarkdown(goal)}</p>
      </div>

      {/* 2. Kryteria sukcesu (Acceptance Criteria) */}
      {criteria.length > 0 && (
        <div className="task-criteria-box">
          <div className="task-criteria-header">
            <span className="task-criteria-badge">KRYTERIA SUKCESU</span>
            <span className="task-criteria-count">{criteria.length} warunki</span>
          </div>
          <ul className="task-criteria-list">
            {criteria.map((crit, idx) => (
              <li key={idx} className="task-criteria-item">
                <span className="task-criteria-check" aria-hidden="true">✓</span>
                <span>{renderInlineMarkdown(crit)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. Rozwijana pełna specyfikacja PM */}
      {isLong && (
        <button
          type="button"
          className="task-body-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "▲ Zwiń specyfikację PM" : "▼ Pokaż pełną specyfikację PM"}
        </button>
      )}

      {open && (
        <div className="task-spec-container">
          {sections.length > 0 ? (
            sections.map((sec, idx) => <SectionBlock key={idx} section={sec} />)
          ) : (
            <pre className="task-body-full">{full}</pre>
          )}
        </div>
      )}
    </div>
  );
}
