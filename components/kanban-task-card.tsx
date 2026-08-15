"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskCard } from "@/lib/types";
import { copyText } from "@/lib/clipboard";

const roleIcon: Record<string, string> = {
  pm: "◆",
  coder: "⌘",
  "coder-parallel": "⌘",
  designer: "✦",
  tester: "✓",
  reviewer: "◇",
  default: "◈",
};

const roleName: Record<string, string> = {
  pm: "Product Manager",
  coder: "Software Engineer",
  "coder-parallel": "Parallel Worker",
  designer: "Product Designer",
  tester: "QA Engineer",
  reviewer: "Code Reviewer",
  default: "Operations Specialist",
};

function relativeTime(timestamp: number | null, nowSec?: number) {
  if (!timestamp) return "brak aktywności";
  const seconds = nowSec ? Math.max(0, Math.floor(nowSec - timestamp)) : 0;
  if (seconds < 60) return `${seconds}s temu`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min temu`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} godz. temu`;
  return new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp * 1000)
  );
}

interface KanbanTaskCardProps {
  task: TaskCard;
  nowSec?: number;
  onSelect: (task: TaskCard) => void;
  onApprove?: (task: TaskCard) => void;
  onCopyId?: (id: string, ok: boolean) => void;
}

export function KanbanTaskCard({ task, nowSec, onSelect, onApprove, onCopyId }: KanbanTaskCardProps) {
  const [copied, setCopied] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { status: task.status, task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  async function copyId() {
    const ok = await copyText(task.id);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
    onCopyId?.(task.id, ok);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-card-wrapper ${isDragging ? "dragging" : ""}`}
      {...attributes}
      {...listeners}
    >
      <button className={`task-card draggable-task ${isDragging ? "dragging" : ""}`} onClick={() => onSelect(task)}>
        <div className="task-meta">
          {/* Kopiowanie ID: `span` z rolą button — zagnieżdżony <button> w <button>
              jest niedozwolony w HTML. onPointerDown zatrzymuje sensor dnd-kit,
              żeby klik nie startował przeciągania karty. */}
          <span
            role="button"
            tabIndex={0}
            className={`task-id-copy ${copied ? "copied" : ""}`}
            title={`Kliknij, aby skopiować ${task.id}`}
            aria-label={`Kopiuj identyfikator zadania ${task.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              void copyId();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void copyId();
            }}
          >
            <code>{task.id}</code>
            <i aria-hidden="true">{copied ? "✓" : "⧉"}</i>
          </span>
          {(() => {
            if (!nowSec) return null;
            const startTs = task.startedAt || task.createdAt;
            const ageHours = startTs ? Math.floor((nowSec - startTs) / 3600) : 0;
            const isStalled = ageHours >= 24 && ["blocked", "review", "running"].includes(task.status);
            if (!isStalled) return null;
            return (
              <span
                className={`sla-badge ${ageHours >= 48 ? "overdue" : "warn"}`}
                title={`Karta w stanie ${task.status} od ${ageHours}h`}
              >
                {ageHours >= 48 ? `⚠️ ${Math.floor(ageHours / 24)}d` : `⏱ ${ageHours}h`}
              </span>
            );
          })()}
          <span className="task-priority">P{task.priority}</span>
        </div>
        <h3>{task.title}</h3>
        <p>{task.body || "Brak opisu"}</p>
        <footer>
          <span className="assignee" title={task.assignee ? roleName[task.assignee] || task.assignee : "Unassigned"}>
            <i>{roleIcon[task.assignee || ""] || "◇"}</i>
            {task.assignee ? roleName[task.assignee] || task.assignee : "unassigned"}
          </span>
          <time>{relativeTime(task.startedAt || task.createdAt, nowSec)}</time>
        </footer>
      </button>
      <div className="task-quick-actions">
        {onApprove && ["blocked", "scheduled"].includes(task.status) && (
          <button
            className="quick-approve"
            title="Akceptuj i odblokuj"
            onClick={(e) => {
              e.stopPropagation();
              onApprove(task);
            }}
          >
            ✓
          </button>
        )}
        <button
          className="quick-view"
          title="Pokaż szczegóły"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(task);
          }}
        >
          …
        </button>
      </div>
    </div>
  );
}
