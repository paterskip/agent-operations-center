---
name: "pm-task-decomposition"
version: "1.0.0"
description: "Dekompozycja inicjatyw biznesowych i problemów na atomowe, testowalne zadania Kanban z kryteriami akceptacji i przypisaniem ról."
author: "AOC / Hermes Core Team"
triggers:
  - "dekompozycja zadania"
  - "rozbij na zadania"
  - "zaplanuj sprint"
  - "przygotuj epik"
  - "task decomposition"
assignedAgents:
  - "pm"
---

# PM Task Decomposition Skill

## Cel i Przeznaczenie
Skill definiuje standard dekompozycji pomysłów (ideas / initiatives) na atomowe zadania w systemie Kanban Hermes / AOC.

## Reguły dekompozycji
1. **Atomowość**: Każde zadanie powinno dotyczyć jednej, spójnej zmiany o szacowanym czasie realizacji 1–4h pracy agenta.
2. **Kryteria Akceptacji (Definition of Done)**: Każde zadanie musi zawierać listę weryfikowalnych warunków sukcesu (testy, snapshoty, schematy).
3. **Przypisanie ról**:
   - `coder-backend` / `coder-frontend` / `coder` — implementacja logiki i UI.
   - `tester` — testy automatyczne, e2e, scenariusze brzegowe.
   - `reviewer` — code review, zgodność z zasadami anti-slop i architekturą.
   - `security` / `sec` — audyt uprawnień, sanityzacja wejścia, bezpieczeństwo auth.
4. **Zależności (Task Links)**: Zadania potomne muszą jasno wskazywać parentIds i childIds.

## Format wyjściowy zadania
```markdown
### [Nazwa modułu] Tytuł zadania
**Rola:** coder-backend
**Priorytet:** 2 (P2)

#### Opis problemu:
Krótki opis kontekstu i celu biznesowego.

#### Wymagane zmiany:
1. Utworzenie pliku X...
2. Dodanie endpointu Y...

#### Kryteria Akceptacji:
- [ ] Test jednostkowy X przechodzi
- [ ] Brak błędów TypeScript (tsc --noEmit)
```

## Anti-Patterns (Czego NIE robić)
- NIE twórz jednego gigantycznego zadania typu "Zrób cały moduł X".
- NIE pomijaj kryteriów akceptacji.
- NIE przypisuj zadań bez określenia wymaganych testów.
