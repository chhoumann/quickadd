# Tooling checks

`pnpm run lint` runs Oxlint, `svelte-policy.mjs`, and
`svelte-check --fail-on-warnings`. `pnpm run build-with-lint` runs the
same checks before producing the application bundle. CI also runs the policy
tests through `pnpm run test`.

Oxlint checks TypeScript and extracted Svelte scripts. Its JavaScript plugin
API cannot inspect Svelte template expressions, so `svelte-policy.mjs` uses
the Svelte compiler's AST for complete components. Both tools use the ten
original selectors and messages exported by `oxlint-plugin.mjs`. `esquery`
matches these selectors without an ESLint runtime.

Oxlint's JavaScript plugin API is alpha and does not have a semver guarantee.
The dependency is pinned. The selectors execute in JavaScript, while built-in
Oxlint rules execute natively. `tsc` uses the native compiler. svelte-check
uses the TypeScript 6 API package, because svelte-check 4.7.6 exits 0 under
`--tsgo` when the native compiler cannot start.

All current components use Svelte 5 runes. Svelte checking and production
compilation require runes mode. The policy checker rejects `$:` statements
and `svelte/store` imports. Shared `.svelte.ts` modules receive the same import
restriction in Oxlint. These checks prevent legacy reactive statements and
store usage from returning.

## Svelte rule migration

This migration preserves the custom guards and the listed safety policies.
It does not reproduce every heuristic in `eslint-plugin-svelte/recommended`.
Compiler and type diagnostics are authoritative for syntax, event-handler
types, and accessibility. CSS style suggestions and refactoring suggestions
listed as retired below now depend on review.

| Former rule | Replacement or disposition |
| --- | --- |
| `comment-directive` | Removed with ESLint's suppression system. Svelte compiler suppressions remain. |
| `system` | Removed with ESLint's parser and processor. |
| `valid-compile` | Strict Svelte checking fails on compiler errors and warnings, including accessibility and unused CSS. |
| `infinite-reactive-loop` | Legacy reactive statements are rejected. This does not statically prove that every `$effect` terminates. |
| `no-immutable-reactive-statements` | Legacy reactive statements are rejected. |
| `no-reactive-functions` | Legacy reactive statements are rejected. |
| `no-reactive-literals` | Legacy reactive statements are rejected. |
| `no-reactive-reassign` | Legacy reactive statements are rejected. |
| `no-store-async` | Legacy store imports are rejected in component code. |
| `require-store-reactive-access` | Legacy store imports are rejected in component code. Custom store objects are not inferred by the new checker. |
| `require-event-dispatcher-types` | Shared selector rejects named dispatcher imports, including aliases. Use callback props. Namespace and dynamic access are not traced. |
| `no-at-html-tags` | Compiler-AST policy rejects `{@html}`. |
| `require-each-key` | Compiler-AST policy requires a key for every each block. |
| `valid-each-key` | Compiler-AST policy requires the key to reference the block's item or index. This is not a uniqueness proof. |
| `no-at-debug-tags` | Compiler-AST policy reports a warning. |
| `no-inspect` | Shared selector reports a warning in components and shared `.svelte.ts` modules. |
| `no-dom-manipulating` | Compiler-AST policy rejects structural or text changes to the named binding used by `bind:this`. It distinguishes module, instance, and local scopes but does not follow arbitrary aliases. |
| `no-dupe-else-if-blocks` | Compiler-AST policy checks duplicate and covered conditions using identifiers, literals, Boolean operators, and strict equality. It skips chains containing calls, property reads, mutations, or coercive operators because their values can change between evaluations. |
| `no-dupe-on-directives` | Compiler-AST policy rejects identical event directives. |
| `no-dupe-use-directives` | Compiler-AST policy rejects identical action directives. |
| `no-not-function-handler` | Svelte type checking verifies event-handler types. |
| `no-object-in-text-mustaches` | Compiler-AST policy rejects object and function literals in text interpolation. |
| `no-raw-special-elements` | Compiler-AST policy requires the `svelte:` prefix for special elements. |
| `no-svelte-internal` | Shared selector rejects imports and re-exports from Svelte internals in components and all TypeScript files. |
| `no-unused-svelte-ignore` | Compiler-AST policy compares suppressed warnings with compiler diagnostics for the target element. |
| `no-inner-declarations` | Removed. Svelte scripts are modules, and block-scoped functions were already allowed. |
| `no-unused-props` | Removed. This rule required TypeScript parser services that the remaining ESLint fallback did not enable. |
| `no-dupe-style-properties` | Retired. The compiler still rejects duplicate style directives; it does not check conflicts with a style string. |
| `no-shorthand-style-property-overrides` | Retired. CSS shorthand conflicts require review. |
| `no-unknown-style-directive-property` | Retired. CSS property spelling requires review. |
| `no-unnecessary-state-wrap` | Retired refactoring suggestion. |
| `no-useless-children-snippet` | Retired refactoring suggestion. |
| `no-useless-mustaches` | Retired style suggestion. |
| `prefer-writable-derived` | Retired refactoring suggestion. |
| `prefer-svelte-reactivity` | Was disabled before the migration. Immutable Set and Map reassignment remains allowed. |
| `no-export-load-in-svelte-module-in-kit-pages` | Inapplicable. QuickAdd is not a SvelteKit app. |
| `no-navigation-without-resolve` | Inapplicable. QuickAdd is not a SvelteKit app. |
| `valid-prop-names-in-kit-pages` | Inapplicable. QuickAdd is not a SvelteKit app. |

The component policy checker also applies `no-console`, `no-new-func`, and
literal string-timer guards to template expressions. These expressions are
outside Oxlint's extracted scripts. These guards respect local script and
template bindings. String-timer checks apply to global timer functions and
methods on unshadowed `window`, `globalThis`, `self`, and `global` objects.
Type-aware promise, deprecation, and implied-eval checks still run on TypeScript
through Oxlint, with the existing test and user-script exceptions.

## Verification

`tests/tooling/sveltePolicy.test.ts` checks all ten forbidden examples in
TypeScript, component scripts, and inline template handlers. It also checks
valid examples, the test-file exclusion, matching diagnostics between Oxlint
and the component checker, and template policy failures. Temporary fixtures
are private and removed after the test. `tests/tooling/svelteCheck.test.ts`
runs `pnpm run check`'s command with the native compiler unable to start and
requires it to fail on a component type error.

```sh
pnpm exec vitest run tests/tooling/sveltePolicy.test.ts tests/tooling/svelteCheck.test.ts
pnpm run build-with-lint
pnpm run test
```

## Follow-up refinements

These refinements follow the tooling migration:

- Type the component checker against Svelte's official AST types and simplify
	the scope and condition analysis. Keep the existing valid and forbidden
	fixtures as upgrade checks.
- Reconsider the blanket `svelte/store` ban. Stores remain supported in Svelte
	5, and removing ESLint does not require banning them.
- Review the retired CSS checks and decide which merit separate enforcement.
- Move checks to upstream Oxlint or Svelte implementations when they cover
	template expressions, reducing the code maintained here.
- Remove the TypeScript 6 compatibility package when svelte-check fails on a
	native compiler that cannot start.
- Measure the final verification pipeline. Earlier evaluation timings predate
	the custom-rule port and the removal of ESLint.
