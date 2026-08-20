---
name: "qa-regression-testing"
version: "1.0.0"
description: "Projektowanie i automatyzacja testów regresyjnych, scenariuszy brzegowych (edge cases) oraz integracyjnych dla API i komponentów AOC."
author: "AOC / Hermes Core Team"
triggers:
  - "napisz testy"
  - "testy regresyjne"
  - "qa audit"
  - "edge cases test"
  - "unit tests"
assignedAgents:
  - "tester"
  - "coder"
---

# QA Regression & Edge Case Testing Skill

## Zasady Testowania
1. **Pokrycie ścieżek krytycznych**:
   - Każdy endpoint API (`route.ts`) musi posiadać plik testowy `*.test.ts` weryfikujący:
     - Poprawne żądanie (200/201).
     - Błędne wejście / naruszenie schematu Zod (400 Bad Request).
     - Brak uprawnień / autoryzacji (401/403).
     - Zachowanie fail-closed przy błędzie bazy danych (500).
2. **Determinizm i Izolacja**:
   - Testy nie mogą zależeć od kolejności wykonywania.
   - Używaj tymczasowych baz danych w pamięci (`:memory:`) lub unikalnych plików tymczasowych ze sprzątaniem w `afterEach` / `afterAll`.
3. **Brak mockowania modułów wysokiego poziomu**:
   - Preferuj testowanie rzeczywistych instancji z poprawnymi danymi wejściowymi.
