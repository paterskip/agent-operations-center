"use client";

import { useMemo, useState } from "react";
import { summarizeBody } from "@/lib/body-summary";

/** Skondensowany opis karty: cel + zwijany pełny opis. */
export function TaskBody({ body }: { body: string | null }) {
  const [open, setOpen] = useState(false);
  const { goal, full, isLong } = useMemo(() => summarizeBody(body), [body]);

  return (
    <div className="task-body">
      <p className="task-goal">{goal}</p>
      {isLong && (
        <button type="button" className="task-body-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Zwiń pełny opis" : "Pokaż pełny opis"}
        </button>
      )}
      {open && <pre className="task-body-full">{full}</pre>}
    </div>
  );
}
