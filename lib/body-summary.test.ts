import { describe, expect, it } from "vitest";
import { summarizeBody } from "./body-summary";

const example = `## Problem
Karta utknęła na 60h z powodu błędów mechanicznych.
## Rozwiązanie
Wprowadzić gate przed review: karta może być przypisana do reviewera tylko gdy lint przechodzi z 0 errors.
## Kryteria sukcesu
- 0 cykli review zmarnowanych
## Priorytet
P2`;

describe("summarizeBody — kondensacja treści karty", () => {
  it("wyciąga cel z sekcji Rozwiązanie", () => {
    const s = summarizeBody(example);
    expect(s.goal).toBe("Wprowadzić gate przed review: karta może być przypisana do reviewera tylko gdy lint przechodzi z 0 errors.");
  });

  it("isLong=true tylko dla długich treści (>300 znaków)", () => {
    expect(summarizeBody(example).isLong).toBe(false);
    expect(summarizeBody("## Problem\n" + "x".repeat(400)).isLong).toBe(true);
  });

  it("skraca długi cel do ~160 znaków z wielokropkiem", () => {
    const long = "## Rozwiązanie\n" + "d".repeat(300);
    const s = summarizeBody(long);
    expect(s.goal.length).toBeLessThanOrEqual(163);
    expect(s.goal.endsWith("…")).toBe(true);
  });

  it("fallback: bez sekcji celu bierze pierwszą linię wstępu", () => {
    const s = summarizeBody("To jest opis zadania bez nagłówków.\nDruga linia.");
    expect(s.goal).toBe("To jest opis zadania bez nagłówków.");
  });

  it("pusty opis", () => {
    const s = summarizeBody("");
    expect(s.goal).toBe("Brak opisu.");
    expect(s.isLong).toBe(false);
  });

  it("ignoruje znaczniki listy przy wyciąganiu celu", () => {
    const s = summarizeBody("## Cel\n- Zbudować panel agentów");
    expect(s.goal).toBe("Zbudować panel agentów");
  });
});
