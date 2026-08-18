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

/** Prezentacyjny komponent karty do użycia w liście oraz w DragOverlay */
export function KanbanCardContent({
  task,
  nowSec,
  copied,
  onCopyId,
  onApprove,
}: {
  task: TaskCard;
  nowSec?: number;
  copied?: boolean;
  onCopyId?: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onApprove?: (task: TaskCard) => void;
}) {
  return (
    <div className="task-card draggable-task">
      <div className="task-meta">
        <span
          role="button"
          tabIndex={0}
          className={`task-id-copy ${copied ? "copied" : ""}`}
          title={`Kliknij, aby skopiować ${task.id}`}
          aria-label={`Kopiuj identyfikator zadania ${task.id}`}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={onCopyId}
          onClick={onCopyId}
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
        <div className="task-footer-right">
          {onApprove && ["blocked", "scheduled"].includes(task.status) && (
            <button
              type="button"
              className="card-quick-approve"
              title={task.status === "scheduled" ? "Akceptuj → Ready" : "Akceptuj i odblokuj"}
              onClick={(e) => {
                e.stopPropagation();
                onApprove(task);
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{task.status === "scheduled" ? "Ready" : "Odblokuj"}</span>
            </button>
          )}
          <time>{relativeTime(task.startedAt || task.createdAt, nowSec)}</time>
        </div>
      </footer>
    </div>
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

  async function copyId(e?: React.MouseEvent | React.KeyboardEvent) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
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
      <div onClick={() => onSelect(task)}>
        <KanbanCardContent
          task={task}
          nowSec={nowSec}
          copied={copied}
          onCopyId={(e) => {
            if ("key" in e && e.key !== "Enter" && e.key !== " ") return;
            void copyId(e);
          }}
          onApprove={onApprove}
        />
      </div>
    </div>
  );
}
