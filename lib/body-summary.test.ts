import { describe, expect, it } from "vitest";
import { summarizeBody } from "./body-summary";

const example = `## Problem
Karta utknęła na 60h z powodu błędów mechanicznych.
## Rozwiązanie
Wprowadzić gate przed review: karta może być przypisana do reviewera tylko gdy lint przechodzi z 0 errors.
## Kryteria sukcesu
- [ ] 0 cykli review zmarnowanych
- [x] Lint i testy przechodzą automatycznie
## Priorytet
P2`;

describe("summarizeBody — kondensacja treści karty i kryteria sukcesu", () => {
  it("wyciąga cel z sekcji Rozwiązanie", () => {
    const s = summarizeBody(example);
    expect(s.goal).toBe("Wprowadzić gate przed review: karta może być przypisana do reviewera tylko gdy lint przechodzi z 0 errors.");
  });

  it("wyciąga listę kryteriów sukcesu z sekcji Kryteria sukcesu", () => {
    const s = summarizeBody(example);
    expect(s.criteria).toEqual([
      "0 cykli review zmarnowanych",
      "Lint i testy przechodzą automatycznie",
    ]);
  });

  it("isLong=true dla treści z sekcjami lub długich", () => {
    expect(summarizeBody(example).isLong).toBe(true);
    expect(summarizeBody("Krótki opis").isLong).toBe(false);
  });

  it("skraca długi cel z wielokropkiem", () => {
    const long = "## Rozwiązanie\n" + "d".repeat(300);
    const s = summarizeBody(long);
    expect(s.goal.length).toBeLessThanOrEqual(183);
    expect(s.goal.endsWith("…")).toBe(true);
  });

  it("fallback: bez sekcji celu bierze pierwszą linię wstępu", () => {
    const s = summarizeBody("To jest opis zadania bez nagłówków.\nDruga linia.");
    expect(s.goal).toBe("To jest opis zadania bez nagłówków.");
  });

  it("pusty opis", () => {
    const s = summarizeBody("");
    expect(s.goal).toBe("Brak opisu.");
    expect(s.criteria).toEqual([]);
    expect(s.isLong).toBe(false);
  });

  it("ignoruje znaczniki listy przy wyciąganiu celu", () => {
    const s = summarizeBody("## Cel\n- Zbudować panel agentów");
    expect(s.goal).toBe("Zbudować panel agentów");
  });
});
