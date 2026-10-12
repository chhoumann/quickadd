import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Shared Svelte config for the tooling that looks it up: svelte-check, the
// vite-plugin-svelte test pipeline. It also silences
// vite-plugin-svelte's "no Svelte config found" notice during tests.
//
// NOTE: the PRODUCTION build does NOT read this file — it uses esbuild-svelte with
// its own compilerOptions (svelteCompilerOptions.mjs) in
// esbuild.config.mjs. Keep this minimal so the two paths stay equivalent.
export default {
	preprocess: vitePreprocess(),
	compilerOptions: { runes: true },
};
