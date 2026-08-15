// Kondensacja treści karty do czytelnego „celu" i kryteriów sukcesu w panelu.
// Czyste funkcje (bez zależności serwerowych), unit-testowane.

export type TaskSection = {
  heading: string;
  lines: string[];
};

export type TaskBodySummary = {
  goal: string;          // „co dokładnie chcemy osiągnąć" — skondensowane
  criteria: string[];    // wyodrębnione kryteria sukcesu (acceptance criteria)
  sections: TaskSection[]; // sparsowane sekcje dla estetycznego renderowania
  full: string;          // oryginalna treść
  isLong: boolean;
};

const GOAL_HEADINGS = /rozwiązanie|cel\b|goal|zadanie|task|rezultat|outcome|do zrobienia|co robimy/i;
const CRITERIA_HEADINGS = /kryteria|kryteria sukcesu|acceptance|definicja ukończenia|definition of done|\bdod\b/i;

/** Zwraca pierwszą niepustą, sensowną linię sekcji (bez znaczników listy). */
function firstLine(lines: string[]): string {
  for (const line of lines) {
    const t = line.replace(/^[-*•)\d.]+\s*(?:\[[ xX]\]\s*)?/, "").trim();
    if (t) return t;
  }
  return "";
}

/** Wyciąga punkty listy z sekcji kryteriów akceptacji. */
function extractListItems(lines: string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Wyciągnij treść z punktorów listy: `- [ ] foo`, `- foo`, `* foo`, `1. foo`
    const clean = trimmed.replace(/^[-*•)\d.]+\s*(?:\[[ xX]\]\s*)?/, "").trim();
    if (clean) items.push(clean);
  }
  return items;
}

export function summarizeBody(raw: string | null | undefined): TaskBodySummary {
  const body = raw ?? "";
  const full = body.trim();
  if (!full) return { goal: "Brak opisu.", criteria: [], sections: [], full: "", isLong: false };

  const lines = full.split("\n");
  const sections: TaskSection[] = [];
  const preamble: string[] = [];
  let cur: TaskSection | null = null;

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

  // 1. „Co chcemy osiągnąć" = sekcja celu (priorytet), inaczej wstęp przed pierwszym nagłówkiem.
  const goalSection = sections.find((s) => GOAL_HEADINGS.test(s.heading));
  let goal = goalSection ? firstLine(goalSection.lines) : "";
  if (!goal) goal = firstLine(preamble);
  if (!goal) goal = firstLine(sections.flatMap((s) => s.lines));
  if (!goal) goal = full.slice(0, 140);

  // Skondensuj cel — pierwsze zdanie, max ~180 znaków.
  if (goal.length > 180) {
    const cut = goal.slice(0, 180);
    const atSpace = cut.lastIndexOf(" ");
    goal = (atSpace > 120 ? cut.slice(0, atSpace) : cut) + "…";
  }

  // 2. Kryteria sukcesu / Acceptance criteria
  const criteriaSection = sections.find((s) => CRITERIA_HEADINGS.test(s.heading));
  const criteria = criteriaSection ? extractListItems(criteriaSection.lines) : [];

  return {
    goal,
    criteria,
    sections,
    full,
    isLong: full.length > 220 || sections.length > 1,
  };
}
