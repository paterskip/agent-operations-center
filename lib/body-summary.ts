// Kondensacja treści karty do czytelnego „celu" w panelu.
// Czyste funkcje (bez zależności serwerowych), unit-testowane.

export type TaskBodySummary = {
  goal: string;   // „co dokładnie chcemy osiągnąć" — skondensowane
  full: string;   // oryginalna treść
  isLong: boolean;
};

const GOAL_HEADINGS = /rozwiązanie|cel\b|goal|zadanie|task|rezultat|outcome|do zrobienia|co robimy/i;

/** Zwraca pierwszą niepustą, sensowną linię sekcji (bez znaczników listy). */
function firstLine(lines: string[]): string {
  for (const line of lines) {
    const t = line.replace(/^[-*•)\s]+/, "").trim();
    if (t) return t;
  }
  return "";
}

export function summarizeBody(raw: string | null | undefined): TaskBodySummary {
  const body = raw ?? "";
  const full = body.trim();
  if (!full) return { goal: "Brak opisu.", full: "", isLong: false };

  const lines = full.split("\n");
  const sections: { heading: string; lines: string[] }[] = [];
  const preamble: string[] = [];
  let cur: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    const m = line.match(/^#{2,3}\s+(.+)$/);
    if (m) {
      if (cur) sections.push(cur);
      cur = { heading: m[1].trim(), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (cur) sections.push(cur);

  // „Co chcemy osiągnąć" = sekcja celu (priorytet), inaczej wstęp przed pierwszym nagłówkiem.
  const goalSection = sections.find((s) => GOAL_HEADINGS.test(s.heading));
  let goal = goalSection ? firstLine(goalSection.lines) : "";
  if (!goal) goal = firstLine(preamble);
  if (!goal) goal = firstLine(sections.flatMap((s) => s.lines));
  if (!goal) goal = full.slice(0, 140);

  // Skondensuj — pierwsze zdanie, max ~160 znaków.
  if (goal.length > 160) {
    const cut = goal.slice(0, 160);
    const atSpace = cut.lastIndexOf(" ");
    goal = (atSpace > 100 ? cut.slice(0, atSpace) : cut) + "…";
  }

  return { goal, full, isLong: full.length > 300 };
}
