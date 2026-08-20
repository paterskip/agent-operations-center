"use client";

import { useMemo, useState } from "react";
import { summarizeBody, type TaskSection } from "@/lib/body-summary";

/** Bezpieczne formatowanie prostych znaczników Markdown w linijce (pogrubienie, inline code, powiązania zadań). */
function renderInlineMarkdown(text: string, onOpenTask?: (taskId: string) => void) {
  const parts: (string | React.ReactNode)[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\bt_[a-f0-9]{6,16}\b|\btask_[a-f0-9]{6,16}\b|\bT-\d+\b|\b[A-Za-z0-9_-]+-\d+\b)/g;
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
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    } else if (/\b(t_[a-f0-9]{6,16}|task_[a-f0-9]{6,16}|T-\d+|[A-Za-z0-9_-]+-\d+)\b/.test(token)) {
      parts.push(
        onOpenTask ? (
          <button
            key={match.index}
            type="button"
            className="task-ref-pill"
            onClick={() => onOpenTask(token)}
            title={`Otwórz powiązane zadanie ${token}`}
          >
            #{token}
          </button>
        ) : (
          <span key={match.index} className="task-ref-pill">
            #{token}
          </span>
        )
      );
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length ? parts : text;
}

/** Renderuje linie Markdown (tekst, listy, bloki kodu) ze spójną typografią. */
function FormattedLines({ lines, onOpenTask }: { lines: string[]; onOpenTask?: (taskId: string) => void }) {
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      const items = [...listItems];
      elements.push(
        <ul key={`list-${elements.length}`} className="task-spec-list">
          {items.map((item, idx) => {
            const clean = item.replace(/^[-*•)\d.]+\s*(?:\[[ xX]\]\s*)?/, "").trim();
            const isChecked = /^[-*•]\s*\[[xX]\]/.test(item);
            return (
              <li key={idx} className={isChecked ? "checked" : ""}>
                <span className="spec-bullet">{isChecked ? "✓" : "•"}</span>
                <span>{renderInlineMarkdown(clean, onOpenTask)}</span>
              </li>
            );
          })}
        </ul>
      );
      listItems = [];
    }
  };

  const flushCode = () => {
    if (codeLines.length > 0) {
      const code = codeLines.join("\n");
      elements.push(
        <pre key={`code-${elements.length}`} className="task-code-block">
          <code>{code}</code>
        </pre>
      );
      codeLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushList();
      continue;
    }

    if (/^[-*•)\d.]+\s/.test(trimmed)) {
      listItems.push(trimmed);
    } else {
      flushList();
      elements.push(
        <p key={`p-${elements.length}`} className="task-spec-text">
          {renderInlineMarkdown(trimmed, onOpenTask)}
        </p>
      );
    }
  }

  flushList();
  flushCode();

  return <>{elements}</>;
}

/** Renderuje treść sekcji specyfikacji PM. */
function SectionBlock({ section, onOpenTask }: { section: TaskSection; onOpenTask?: (taskId: string) => void }) {
  return (
    <div className="task-spec-section">
      <h4 className="task-spec-heading">{section.heading}</h4>
      <FormattedLines lines={section.lines} onOpenTask={onOpenTask} />
    </div>
  );
}

/** Ustrukturyzowany opis zadania: Cel + Kryteria sukcesu + Pełna specyfikacja PM. */
export function TaskBody({ body, onOpenTask }: { body: string | null; onOpenTask?: (taskId: string) => void }) {
  const [open, setOpen] = useState(false);
  const { goal, criteria, sections, full, isLong } = useMemo(() => summarizeBody(body), [body]);

  return (
    <div className="task-body">
      {/* 1. Wyróżniony Cel */}
      <div className="task-goal-box">
        <span className="task-goal-badge">CEL ZADANIA</span>
        <p className="task-goal-text">{renderInlineMarkdown(goal, onOpenTask)}</p>
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
                <span>{renderInlineMarkdown(crit, onOpenTask)}</span>
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
            sections.map((sec, idx) => <SectionBlock key={idx} section={sec} onOpenTask={onOpenTask} />)
          ) : (
            <div className="task-spec-section">
              <FormattedLines lines={full.split("\n")} onOpenTask={onOpenTask} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
