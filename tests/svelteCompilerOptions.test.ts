import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "svelte/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { svelteCompilerOptions } from "../svelteCompilerOptions.mjs";

// Svelte injects a component's CSS only if no <style> with the component's style
// id is in the document yet, and Obsidian updates plugins without reloading the
// app. A component whose compiled CSS changes between two QuickAdd versions must
// therefore get a new style id, or the updated plugin keeps the old CSS (#1908).
describe("production Svelte compiler options", () => {
	let dir: string;
	let filename: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "quickadd-css-hash-"));
		filename = join(dir, "Component.svelte");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	/** Compiles one version of the component the way the production build does. */
	function build(source: string): { styleId: string; css: string } {
		writeFileSync(filename, source);
		const { js } = compile(source, { ...svelteCompilerOptions, filename });
		const injected = js.code.match(/hash: '(svelte-[a-z0-9]+)',\s*code: '([^']*)'/);
		if (!injected) throw new Error(`No injected CSS in:\n${js.code}`);
		return { styleId: injected[1], css: injected[2] };
	}

	it("gives a component a new style id when its CSS changes", () => {
		const before = build(`<p class="msg">Hi</p><style>.msg { color: grey; }</style>`);
		const after = build(`<p class="msg">Hi</p><style>.msg { color: red; }</style>`);

		expect(after.css).not.toBe(before.css);
		expect(after.styleId).not.toBe(before.styleId);
	});

	it("gives a component a new style id when only its markup changes the compiled CSS", () => {
		// Svelte drops `.msg` while nothing uses it, so the compiled CSS changes
		// even though the <style> block does not.
		const style = `<style>.msg { color: red; } .row { display: flex; }</style>`;
		const before = build(`<div class="row">Hi</div>${style}`);
		const after = build(`<div class="row"><p class="msg">Hi</p></div>${style}`);

		expect(after.css).not.toBe(before.css);
		expect(after.styleId).not.toBe(before.styleId);
	});
});
