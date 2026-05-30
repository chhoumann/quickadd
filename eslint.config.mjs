import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

export default [
    {
        // Global ignores: a standalone object with only `ignores` applies repo-wide in flat config.
        ignores: ['node_modules/**', 'dist/**', 'docs/**', 'main.js', '**/*.d.ts'],
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module',
            },
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
        plugins: {
            '@typescript-eslint': typescriptEslint,
        },
        rules: {
            ...typescriptEslint.configs.recommended.rules,
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
            '@typescript-eslint/ban-ts-comment': 'off',
            'no-prototype-builtins': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/consistent-type-imports': 'warn',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/restrict-template-expressions': 'off',
        },
    },
    // Lint Svelte 5 components (runes-aware via svelte-eslint-parser).
    ...svelte.configs['flat/recommended'],
    {
        files: ['**/*.svelte', '**/*.svelte.ts'],
        languageOptions: {
            parser: svelteParser,
            parserOptions: {
                // Parse <script lang="ts"> with the TS parser.
                parser: typescriptParser,
            },
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            // The package modals' Set/Map state is updated by immutable REASSIGNMENT
            // (new Set/Map -> assign), which is reactive under $state. SvelteSet/SvelteMap
            // are only needed for in-place mutation, so this rule is a false positive here.
            'svelte/prefer-svelte-reactivity': 'off',

            // eslint-plugin-svelte v3 ships no dedicated a11y-* rules; the Svelte 5
            // compiler emits the a11y_* warnings instead. valid-compile surfaces those
            // (plus other compiler warnings, e.g. css_unused_selector) as lint errors,
            // so a bare interactive <div>/<span> can't be reintroduced without CI
            // catching it. Baseline is clean after the #1250 a11y pass. Note: this is a
            // regression ratchet — it does NOT police accessible names on icon-only
            // buttons or keyboard-operable drag handles, which are covered by tests.
            'svelte/valid-compile': 'error',
        },
    },
    // Special rules for main.ts to preserve critical import order
    {
        files: ['src/main.ts'],
        rules: {
            // Disable any import sorting in main.ts to preserve dependency order
            'sort-imports': 'off',
        },
    },
];