---
name: "anti-slop-code-review"
version: "1.0.0"
description: "Rygorystyczny przegląd kodu TypeScript i React według standardów Anti-Slop: zero compiler bluffing, boundary validation z Zod, brak as any, obowiązkowe komentarze bezpieczeństwa."
author: "AOC / Hermes Core Team"
triggers:
  - "review PR"
  - "code review"
  - "sprawdź jakość kodu"
  - "anti-slop audit"
  - "weryfikacja pull requesta"
assignedAgents:
  - "reviewer"
  - "coder"
---

# Anti-Slop TypeScript & React Code Review Skill

## Zasady Walidacji Kodu
1. **Zero Compiler Bluffing**:
   - Całkowity zakaz `as unknown as T`, `as any as T` oraz wzorców widen-then-assert.
   - Wszelkie rzutowania `as Type` muszą posiadać bezpośrednio poprzedzający komentarz `// SAFETY: <wyjaśnienie dlaczego kompilator nie może tego wywnioskować>`.
2. **Boundary Validation**:
   - Wszystkie dane zewnętrzne (API, LocalStorage, Query Params, pliki JSON) muszą być parsowane schematami Zod / runtime guards.
3. **Brak luźnych słowników**:
   - Zakaz `Record<string, any>` i ogólnego `object`.
   - Zastąpienie jawnymi interfejsami i uniami dyskryminowanymi.
4. **Czysty stan w React**:
   - Zakaz warunkowych pustych spreadów `{ ...(cond ? { a: 1 } : {}) }`.
   - Reprezentacja stanów asynchronicznych jako unia dyskryminowana (`status: 'idle' | 'loading' | 'success' | 'error'`).
5. **Rygor testów**:
   - Zakaz monkey-patchingu przez kruche `vi.mock()`. Preferowanie fixture'ów i dependency injection.
