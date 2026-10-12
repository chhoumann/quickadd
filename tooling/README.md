# Tooling checks

`pnpm run lint` runs Oxlint, the
[`svelte-policy`](https://github.com/chhoumann/svelte-policy) component
checker, and `svelte-check --fail-on-warnings`. `pnpm run build-with-lint`
runs the same checks before producing the application bundle. CI also runs
the policy tests through `pnpm run test`.

Oxlint checks TypeScript and extracted Svelte scripts. Its JavaScript plugin
API cannot inspect Svelte template expressions, so the `svelte-policy`
checker uses the Svelte compiler's AST for complete components. The package
also provides the Oxlint plugin, which `.oxlintrc.syntax.json` loads under
the `quickadd` prefix. `svelte-policy.json` gives both tools the ten original
selectors and messages. For components, it also turns on the store and runes
rules and sets the `no-console` message.

Oxlint's JavaScript plugin API is alpha and does not have a semver guarantee.
The dependency is pinned. The selectors execute in JavaScript, while built-in
Oxlint rules execute natively. `tsc` uses the native compiler. svelte-check
uses the TypeScript 6 API package, because svelte-check 4.7.6 exits 0 under
`--tsgo` when the native compiler cannot start.

All current components use Svelte 5 runes. Svelte checking and production
compilation require runes mode. The policy checker rejects `$:` statements
and `svelte/store` imports. Shared `.svelte.ts` modules receive the same
restrictions in Oxlint. These checks prevent legacy reactive statements and
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
| `no-store-async` | `no-svelte-store` rejects legacy store imports in component code. |
| `require-store-reactive-access` | `no-svelte-store` rejects legacy store imports in component code. Custom store objects are not inferred by the new checker. |
| `require-event-dispatcher-types` | `runes-only` rejects named dispatcher imports, including aliases. Use callback props. Namespace and dynamic access are not traced. |
| `no-at-html-tags` | Compiler-AST policy rejects `{@html}`. |
| `require-each-key` | Compiler-AST policy requires a key for every each block with an item. |
| `valid-each-key` | Compiler-AST policy requires the key to reference the block's item or index. This is not a uniqueness proof. |
| `no-at-debug-tags` | Compiler-AST policy reports a warning. |
| `no-inspect` | `no-inspect` reports a warning in components and shared `.svelte.ts` modules. |
| `no-dom-manipulating` | Compiler-AST policy rejects structural or text changes to the named binding used by `bind:this`. It distinguishes module, instance, and local scopes but does not follow arbitrary aliases. |
| `no-dupe-else-if-blocks` | Compiler-AST policy checks duplicate and covered conditions using identifiers, literals, Boolean operators, and strict equality. It skips chains containing calls, property reads, mutations, or coercive operators because their values can change between evaluations. |
| `no-dupe-on-directives` | Compiler-AST policy rejects identical event directives. |
| `no-dupe-use-directives` | Compiler-AST policy rejects identical action directives. |
| `no-not-function-handler` | Compiler-AST policy rejects a literal, object, array, or class as an `on*` attribute or `on:` directive value, directly or through a `const`. Svelte type checking also verifies event-handler types. |
| `no-object-in-text-mustaches` | Compiler-AST policy rejects object and function literals in text interpolation. |
| `no-raw-special-elements` | Compiler-AST policy requires the `svelte:` prefix for special elements. |
| `no-svelte-internal` | `no-svelte-internal` rejects imports and re-exports from Svelte internals in components and all TypeScript files. |
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

The package closes gaps in the checker this migration first added:

- `svelte-ignore` codes may be dashed, comma-separated, or on the next line,
	and a markup comment applies to the next node past any text.
- `svelte-ignore` comments in legacy components are checked.
- Object, array, function, and class literals are rejected in attribute
	values that mix text and mustaches.
- Each blocks without an item no longer need a key.
- `no-not-function-handler` is back as a compiler-AST rule.
- Member names written as backtick strings are resolved for
	`no-implied-eval` and `no-dom-manipulating`.
- A `svelte-ignore` without a code is reported, and script `svelte-ignore`
	comments are checked.
- Ignore codes are read per compile mode, including Svelte's legacy code
	replacements.

## Verification

`tests/tooling/sveltePolicy.test.ts` checks QuickAdd's wiring of the package.
Oxlint with `.oxlintrc.syntax.json` reports all ten forbidden examples in
TypeScript with the component checker's messages, the store, dispatcher, and
`$inspect` rules in shared `.svelte.ts` modules, and the internals guard in
every TypeScript file. Valid examples and test files pass the syntax guards.
The component checker applies the store, runes, and `no-console` settings
from `svelte-policy.json`. The package's own tests cover the policies,
including every fixture this file held before. Temporary fixtures are
private and removed after the test. `tests/tooling/svelteCheck.test.ts`
requires `pnpm run check`'s command to fail on compiler warnings, legacy
reactivity, and type errors, including when the native compiler cannot start.

```sh
pnpm exec vitest run tests/tooling/sveltePolicy.test.ts tests/tooling/svelteCheck.test.ts
pnpm run build-with-lint
pnpm run test
```

## Follow-up refinements

These refinements follow the tooling migration:

- Reconsider the blanket `svelte/store` ban. Stores remain supported in Svelte
	5, and removing ESLint does not require banning them.
- Review the retired CSS checks and decide which merit separate enforcement.
- Move checks to upstream Oxlint or Svelte implementations when they cover
	template expressions, reducing the code maintained in `svelte-policy`.
- Remove the TypeScript 6 compatibility package when svelte-check runs on the
	native compiler's API and fails when that compiler cannot start.
- Measure the final verification pipeline. Earlier evaluation timings predate
	the custom-rule port and the removal of ESLint.
