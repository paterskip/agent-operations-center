"use client";

import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { KanbanTaskCard } from "./kanban-task-card";
import type { TaskCard } from "@/lib/types";

interface KanbanColumnProps {
  status: string;
  statusLabel: string;
  statusHelp: string;
  tasks: TaskCard[];
  isCollapsed: boolean;
  isMobile: boolean;
  isInvalidDrop?: boolean;
  onToggle: () => void;
  onSelectTask: (task: TaskCard) => void;
  onApproveTask?: (task: TaskCard) => void;
  onCopyId?: (id: string, ok: boolean) => void;
}

export function KanbanColumn({
  status,
  statusLabel,
  statusHelp,
  tasks,
  isCollapsed,
  isMobile,
  isInvalidDrop,
  onToggle,
  onSelectTask,
  onApproveTask,
  onCopyId,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const isEmpty = tasks.length === 0;

  return (
    <section
      ref={setNodeRef}
      className={`kanban-column ${status} droppable-column ${isCollapsed ? "collapsed" : ""} ${isEmpty && !isCollapsed ? "empty" : ""} ${isOver ? "drag-over" : ""} ${isOver && isInvalidDrop ? "drag-invalid" : ""}`}
      aria-label={statusLabel}
    >
      <div className="drag-indicator" aria-hidden="true" />
      <button type="button" className="column-toggle" onClick={onToggle} aria-expanded={!isCollapsed} title={`${statusHelp || ""} — kliknij aby ${isCollapsed ? "rozwinąć" : "zwinąć"}`}>
        <span className="status-dot" />
        <strong>{statusLabel}</strong>
        <b>{tasks.length}</b>
      </button>
      {!isCollapsed && (
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <div className="task-stack">
            {tasks.map((task) => (
              <KanbanTaskCard
                key={task.id}
                task={task}
                onSelect={onSelectTask}
                onApprove={onApproveTask}
                onCopyId={onCopyId}
              />
            ))}
            {isEmpty && <div className="empty-column">{isMobile ? "—" : "Brak zadań — upuść tutaj kartę"}</div>}
          </div>
        </SortableContext>
      )}
    </section>
  );
}
