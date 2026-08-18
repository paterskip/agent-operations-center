---
description: "Anti-Slop TypeScript & Frontend Engineering Standards: strict type-safety, zero compiler bluffing, and robust frontend practices."
always_on: true
---

# Anti-Slop & High-Signal TypeScript / Frontend Standards

These rules prevent AI code degradation ("slop"), compiler bluffing, and unsafe TypeScript/React patterns.

## 1. Zero Compiler Bluffing & Type Assertions
- **NO chained type assertions:** Never write `x as unknown as T` or `x as any as T`. If types don't match, fix the data flow, create a type guard, or parse at runtime.
- **NO widen-then-assert:** Never widen a value to `any`/`unknown` and subsequently cast it.
- **NO `as any`:** Strict ban on `any`. Use properly narrowed types, generics, or validated schemas.
- **Mandatory Safety Comments:** If a non-const type assertion (`as Type`) is mathematically unavoidable, it **MUST** be immediately preceded by a safety comment explaining why the compiler cannot deduce it:
  ```ts
  // GOOD
  // SAFETY: The key is guaranteed to exist because Object.keys was filtered against KnownKeys set.
  const val = dict[key] as ValidKeyType;

  // BAD
  const val = dict[key] as ValidKeyType;
  ```

## 2. Boundary Validation Over Type Assertions
- **Never assert API / Storage / External data:** External boundaries (API responses, LocalStorage, SearchParams, URL params) are unknown by definition.
- **Use Runtime Schema Validation:** Always parse external inputs using runtime validation (e.g. Zod, Valibot) instead of `const data = await res.json() as UserData`.

## 3. Strict Domain Modeling (No Loose Dictionaries or Parameter Bags)
- **NO `Record<string, any>` or generic `object`:** Always define explicit interfaces or discriminated unions for component props, API payloads, and state.
- **NO unconstrained `unknown` in internal domain logic:** Narrow values immediately at entry points.
- **NO shape names in identifiers:** Avoid naming variables with redundant type tags (e.g., avoid `usersArray`, `configObject`, `flagBoolean`; use `users`, `config`, `isEnabled`).

## 4. React & Frontend State Safety
- **NO conditional empty object spreading:**
  ```ts
  // BAD (anti-slop violation)
  const props = { ...(isPrimary ? { variant: 'primary' } : {}) };

  // GOOD
  const props = { variant: isPrimary ? 'primary' : undefined };
  ```
- **NO bypassing type checking via Reflection:** Never use `Reflect.get` or `Reflect.apply` to access unexposed or private properties.
- **Proper Discriminated Unions for UI States:** Represent async/component state as explicit discriminated unions (`{ status: 'idle' } | { status: 'loading' } | { status: 'success'; data: T } | { status: 'error'; error: Error }`) rather than separate boolean flags (`isLoading`, `isError`, `data`).

## 5. Testing & Mocking Rigor
- **NO low-signal module mocking:** Prefer real fixtures, test doubles via dependency injection, and MSW (Mock Service Worker) over brittle `jest.mock()` / `vi.mock()` monkey-patching.
