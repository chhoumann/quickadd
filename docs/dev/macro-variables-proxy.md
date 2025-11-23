# QuickAdd Macro Variables: Single-Source-of-Truth Refactor Guide

**Audience:** QuickAdd contributors touching macro execution, user scripts, AI helpers, or choice executor plumbing.  
**Goal:** Explain the regression (BUG #995), the Map-backed proxy solution, and how to work safely with shared macro variables going forward.

---

## 1) Context: How macro variables are shared

- **ChoiceExecutor** owns a `Map<string, unknown> variables` that survives across nested choice executions.
- **MacroChoiceEngine** exposes `params` to user scripts. Historically, `params.variables` was a plain object copied from the Map after each command and pushed back afterward.
- **SingleMacroEngine** and **SingleInlineScriptEngine** reuse the same `MacroChoiceEngine` core.

### The old flow (v2.8.0, broken)
1. Execute command (including user script) using `this.params.variables` (plain object).
2. After command, pull values from executor Map into `params.variables`.
3. Then push `params.variables` back into the Map.

This ordering overwrote mutations a script just made with stale Map data. Multiple user scripts in the same macro would all see the first non-null value—BUG #995.

### Requirements we must satisfy
- **Correctness:** A script’s changes must be immediately visible to the next command.
- **Safety:** Avoid stale overwrites; handle commands that write directly to the Map (e.g., AI helpers).
- **Compatibility:** User scripts often destructure `const { variables } = params;` and call helpers like `hasOwnProperty`.
- **Maintainability:** Minimize sync points and special cases.

---

## 2) The fix: Map-backed proxy as single source of truth

**Key idea:** Keep one canonical store (the Map). Present an object-like facade (`params.variables`) via a `Proxy` so reads/writes/delete/has/iteration map directly to the Map. No push/pull needed.

File: `src/utils/variablesProxy.ts`
- Target object includes only a `hasOwnProperty` shim for backward compatibility; no full Object prototype.
- Proxy traps:
  - `get/set/deleteProperty/has` delegate to the Map.
  - `ownKeys` and `getOwnPropertyDescriptor` make `Object.keys`, `for...in`, `JSON.stringify`, and `Object.assign` work as expected.
  - Symbols are ignored to keep behavior predictable.

MacroChoiceEngine now sets:
```ts
this.params.variables = createVariablesProxy(this.choiceExecutor.variables);
```
and removes all pull/push sync logic.

---

## 3) Variable Map selection & merge rules

Constructor logic (`MacroChoiceEngine`):
- If a `variables` Map is supplied, use it as the shared map.
- If the executor already had a Map and a new Map is provided, merge existing keys into the provided Map (don’t drop prior state).
- Otherwise, reuse executor Map or create a fresh one.
- Always reassign `choiceExecutor.variables = sharedVariables` so downstream sees the canonical Map.

Rationale: prevent accidental data loss when callers pass a new Map but expect existing executor state to persist.

---

## 4) AI helper consistency

In `src/quickAddApi.ts`, AI prompt helpers previously did `Object.assign(choiceExecutor.variables, assistantRes)`—a no-op on Map. Now they iterate `Object.entries(assistantRes)` and `set` into the Map. This aligns with the single-source-of-truth model.

---

## 5) Tests added/updated

- `src/engine/MacroChoiceEngine.entry.test.ts`
  - Regression: sequential user scripts log `undefined, 1, 2, 3` and final `target === 3`.
  - Merge safeguard: existing executor vars are preserved when a custom Map is provided.
- `src/utils/variablesProxy.test.ts`
  - Read/write/delete, enumeration, external Map mutation visibility.
  - `hasOwnProperty` shim works; `toString` remains undefined (no Object prototype).
  - `for...in`, `Object.assign`, `JSON.stringify` compatibility.

Run: `bun run test` (full suite), `bun run lint`, `bun run build-with-lint`.

---

## 6) How to extend safely

When adding new commands or helpers that manipulate variables:
- **Always write through the Map** (`choiceExecutor.variables.set(...)`) or through `params.variables` (proxy will hit the Map).
- **Do not reintroduce push/pull sync**—the proxy eliminates the need.
- **Avoid spreading/cloning `params.variables` into plain objects** unless you truly need a snapshot. Remember snapshots will decouple from live Map updates.
- If you must add helpers that expect Object prototype methods, consider explicit shims instead of restoring the prototype chain.

---

## 7) Potential pitfalls & how to avoid them

- **Object.assign on Map**: No-op. Always iterate and `set`.
- **Prototype expectations**: Only `hasOwnProperty` is provided. Other prototype methods (e.g., `toString`) are intentionally absent to avoid prototype pollution. Accessing them should yield `undefined`.
- **Multiple Maps**: Passing a new Map into engines will merge in prior executor keys, but not vice versa. Be explicit about which Map you want shared.
- **Serialization**: `JSON.stringify(params.variables)` works because `ownKeys`/descriptors are implemented; Symbol keys are ignored.

---

## 8) Quick implementation checklist (if you touch this area)

1. Need shared macro vars? Use the existing `choiceExecutor.variables` Map; wrap with `createVariablesProxy` for object-style access.
2. Writing new helpers? Use `Map.set`/`get`/`delete` or the proxy—never `Object.assign` on a Map.
3. Adding tests? Cover:
   - Sequential command visibility.
   - External Map mutations seen through proxy.
   - Enumeration and reflection behaviors.
4. Run `bun run build-with-lint` and `bun run test`.

---

## 9) Rationale recap

- **Single source of truth** prevents sync races.
- **Proxy facade** preserves the ergonomic API (`params.variables.foo`) scripts rely on.
- **Shims, not prototypes** balance backward compatibility with safety.
- **Map merge** avoids silent data loss when callers swap Maps.
- **Consistent writes** ensure AI/other helpers don’t bypass the canonical store.

---

## 10) If you need to change behavior later

- Update `variablesProxy` first; add targeted tests.
- Keep constructor merge rules documented; adjust tests accordingly.
- Re-run full suite—performance tests are occasionally spiky; rerun once if a perf check flakes.

---

## File map for quick navigation

- `src/utils/variablesProxy.ts` — proxy implementation.
- `src/engine/MacroChoiceEngine.ts` — variable Map selection and params wiring.
- `src/engine/MacroChoiceEngine.entry.test.ts` — macro regression tests.
- `src/utils/variablesProxy.test.ts` — proxy behavior tests.
- `src/quickAddApi.ts` — AI helper variable assignment fixes.

