"use client";

import { useEffect, useRef, useState } from "react";
import type { DashboardSnapshot, TaskCard } from "@/lib/types";

function fuzzyMatch(text: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i].toLowerCase() === query[qi].toLowerCase()) qi++;
  }
  return qi === query.length;
}

interface Props {
  open: boolean;
  onClose: () => void;
  data: DashboardSnapshot | null;
  onSelectBoard: (slug: string) => void;
  onSelectTask: (task: TaskCard) => void;
  actions?: { label: string; icon: string; hint?: string; onRun: () => void }[];
}

export default function SearchModal({ open, onClose, data, onSelectBoard, onSelectTask, actions = [] }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => { setQuery(""); inputRef.current?.focus(); }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) { window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }
  }, [open, onClose]);

  if (!open || !data) return null;

  const roleAliases: Record<string, string[]> = {
    backend: ["coder-backend", "backend"],
    frontend: ["coder-frontend", "frontend"],
    sec: ["security", "sec"],
    security: ["security", "sec"],
    pm: ["pm"],
    coder: ["coder", "coder-parallel"],
    designer: ["designer"],
    tester: ["tester", "qa"],
    qa: ["tester", "qa"],
    reviewer: ["reviewer"],
  };

  const lower = query.toLowerCase().trim();
  const isRoleFilter = lower.startsWith("@");
  const roleQuery = isRoleFilter ? lower.slice(1).trim() : "";
  const matchedSlugs = isRoleFilter && roleQuery ? roleAliases[roleQuery] || [roleQuery] : [];

  const actionResults = isRoleFilter
    ? []
    : lower
    ? actions.filter((a) => fuzzyMatch(a.label, lower) || (a.hint && fuzzyMatch(a.hint, lower)))
    : actions;
  const boardResults = isRoleFilter
    ? []
    : lower
    ? data.boards.filter((b) => fuzzyMatch(b.name, lower) || fuzzyMatch(b.slug, lower))
    : data.boards;
  const taskResults = isRoleFilter
    ? data.tasks.filter((t) => (t.assignee ? matchedSlugs.some((s) => t.assignee?.toLowerCase().includes(s)) : false))
    : lower
    ? data.tasks.filter((t) => fuzzyMatch(t.id, lower) || fuzzyMatch(t.title, lower) || fuzzyMatch(t.assignee || "", lower) || fuzzyMatch(t.status, lower))
    : data.tasks.slice(0, 10);

  return (
    <div className="search-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="search-modal" role="dialog" aria-label="Wyszukiwanie">
        <div className="search-input-row">
          <span className="search-icon">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj zadań, boardów, akcji lub @rola (np. @backend)..."
          />
          <kbd>Esc</kbd>
        </div>
        <div className="search-results">
          {actionResults.length > 0 && (
            <section>
              <h4>Polecenia i Akcje</h4>
              {actionResults.map((a) => (
                <button key={a.label} className="search-result" onClick={() => { a.onRun(); onClose(); }}>
                  <span className="result-icon">{a.icon}</span>
                  <div><strong>{a.label}</strong>{a.hint && <small>{a.hint}</small>}</div>
                </button>
              ))}
            </section>
          )}
          {boardResults.length > 0 && (
            <section>
              <h4>Boardy</h4>
              {boardResults.map((b) => (
                <button key={b.slug} className="search-result" onClick={() => { onSelectBoard(b.slug); onClose(); }}>
                  <span className="result-icon">{b.icon}</span>
                  <div><strong>{b.name}</strong><small>{b.slug} · {b.counts.running || 0} active · {b.counts.blocked || 0} blocked</small></div>
                </button>
              ))}
            </section>
          )}
          {taskResults.length > 0 && (
            <section>
              <h4>Zadania</h4>
              {taskResults.map((t) => (
                <button key={t.id} className="search-result" onClick={() => { onSelectTask(t); onClose(); }}>
                  <span className={`result-badge ${t.status}`}>{t.status}</span>
                  <div><strong>{t.title}</strong><small>{t.id} · {t.assignee || "unassigned"} · {t.boardSlug}</small></div>
                </button>
              ))}
            </section>
          )}
          {lower && !boardResults.length && !taskResults.length && <p className="search-empty">Nic nie znaleziono dla „{query}”</p>}
        </div>
      </div>
    </div>
  );
}
