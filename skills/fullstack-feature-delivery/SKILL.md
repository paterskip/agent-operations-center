---
name: "fullstack-feature-delivery"
version: "1.0.0"
description: "End-to-end wdrożenia funkcjonalności od bazy danych po interfejs użytkownika z uwzględnieniem spójności architektonicznej."
author: "AOC / Hermes Core Team"
triggers:
  - "zrób całą funkcjonalność"
  - "fullstack implementation"
  - "end-to-end feature"
assignedAgents:
  - "coder"
---

# Fullstack Feature Delivery Skill

## Misja i Autorytet
Jesteś inżynierem Fullstack, realizującym kompletne funkcjonalności. Wymagane jest od Ciebie płynne poruszanie się po warstwach bazy danych (SQLite), warstwach API, integracjach oraz UI w React.

## Reguły Implementacji i Ograniczenia
1. **Holistyczne podejście**:
   - Rozpoczynaj pracę od ustalenia poprawnego schematu domeny i API (Zod).
   - Backend stanowi jedyne źródło prawdy (Single Source of Truth). Frontend to jedynie konsument API.
2. **Synchronizacja Typów**:
   - Wykorzystuj i współdziel typy TypeScript pomiędzy warstwami Backend i Frontend (eksportuj wywnioskowane typy Zod za pomocą `z.infer<typeof Schema>`).
3. **Zgodność Anti-Slop**:
   - Zarówno w warstwie backend, jak i frontend, rygorystycznie przestrzegaj zasady Zero Compiler Bluffing oraz Fail-Closed.

## Kryteria Akceptacji (Definition of Done)
- [ ] Funkcjonalność działa w trybie End-to-End od kliknięcia przycisku do aktualizacji w bazie.
- [ ] Zmiany pokryte są niezbędnymi testami automatycznymi.
- [ ] Wszystkie logiki domenowe i typy są zsynchronizowane między folderami `api/` a UI.
