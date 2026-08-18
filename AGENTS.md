<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Anti-Slop TypeScript & Frontend Guidelines

All agents working on this codebase must adhere to the high-signal, anti-slop guidelines defined in [`.agents/rules/anti-slop.md`](file:///home/pablo/agent-operations-center/.agents/rules/anti-slop.md):
- **Zero compiler bluffing**: No `as unknown as T`, no `as any`, and no widen-then-assert patterns.
- **Mandatory Safety Comments**: Any unavoidable `as Type` must have a `// SAFETY: <explanation>` comment.
- **Boundary Validation**: Validate external data (APIs, URLs, storage) with Zod/runtime schemas rather than type assertions.
- **No loose dictionaries**: Use explicit interfaces/discriminated unions instead of `Record<string, any>` or generic `object`.
- **Clean React patterns**: Avoid conditional empty spreads `{ ...(cond ? { a: 1 } : {}) }`; use discriminated unions for UI state.
