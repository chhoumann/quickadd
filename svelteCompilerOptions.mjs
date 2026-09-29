import { readFileSync } from "node:fs";
import { VERSION } from "svelte/compiler";

// Compiler options for the production build (esbuild.config.mjs).
//
// Svelte injects each component's CSS as <style id={cssHash}> and skips the
// injection when that id is already in the document; it never replaces or
// removes the element. Obsidian updates a plugin without reloading the app, so
// with Svelte's default hash (the filename alone) an updated QuickAdd renders
// with the previous version's CSS until restart (#1908).
//
// The hash therefore covers everything the compiled CSS depends on: the
// component's full source (the template matters too, because Svelte drops
// selectors that match nothing) and the compiler version. Styles a previous
// version left behind then target class names no element uses anymore. That
// holds because every component rule, including `:global(...)` parts, sits
// under the component's scoped class; put fully global rules in styles.css,
// which Obsidian replaces on update.
/** @type {import("svelte/compiler").CompileOptions} */
export const svelteCompilerOptions = {
	css: "injected",
	cssHash: ({ hash, filename }) =>
		`svelte-${hash(filename + VERSION + readFileSync(filename, "utf8"))}`,
};
