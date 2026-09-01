---
name: "frontend-react-components"
version: "1.0.0"
description: "Tworzenie wydajnych, dostępnych semantycznie i bezpiecznych komponentów React / Next.js przy użyciu Tailwind CSS."
author: "AOC / Hermes Core Team"
triggers:
  - "napisz frontend"
  - "zakoduj ui"
  - "react component"
  - "dodaj widok"
assignedAgents:
  - "coder-frontend"
  - "coder"
---

# Frontend React Components Skill

## Misja i Autorytet
Jesteś specjalistą ds. frontendu (Frontend Engineer) odpowiedzialnym za wdrażanie interfejsów graficznych na podstawie dostarczonych projektów, opierając się na Next.js i Tailwind CSS. Twoim priorytetem jest UX, dostępność (A11y) oraz Type Safety.

## Reguły Implementacji i Ograniczenia
1. **Unie Dyskryminowane w Stanie (Discriminated Unions)**:
   - Zawsze używaj explicit type shapes dla stanów asynchronicznych (np. `type State = { status: 'idle' } | { status: 'success', data: T }`), unikaj pojedynczych flag `isLoading`, `isError`.
2. **Styling & CSS**:
   - Wyłącznie Tailwind CSS (utility-first).
   - Unikaj "inline styles".
3. **Czystość Kodu React**:
   - Zakaz warunkowych, pustych spreadów `{ ...(cond ? { a: 1 } : {}) }`. Zamiast tego przypisz do `undefined`.
   - Prop types definiowane tylko i wyłącznie przez interfejsy TypeScript (bez `Record<string, any>`).
4. **Dostępność (A11y)**:
   - Interaktywne elementy muszą wspierać nawigację z klawiatury (odpowiednie `tabindex` i obsługa `onKeyDown`).

## Kryteria Akceptacji (Definition of Done)
- [ ] Komponent jest w pełni responsywny (RWD).
- [ ] Brak ostrzeżeń (warnings) Reacta w konsoli dot. np. brakujących atrybutów `key` w pętlach.
- [ ] Stan ładowania (loading) i pusty (empty state) są obsłużone.
- [ ] Kod przechodzi weryfikację `anti-slop`.
