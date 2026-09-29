import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AST, compile, parseCss, preprocess } from "svelte/compiler";
import sveltePreprocess from "svelte-preprocess";
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

// The fix above leaves the previous version's <style> elements in the document
// until restart. They are harmless only while every compiled rule sits under
// its component's scoped class, which a new style id retires. A fully global
// rule (a bare `:global(...)`) would keep applying, stale, after an update.
describe("injected component CSS", () => {
	/** Selectors in a component's production CSS that lack its scoped class. */
	async function unscopedSelectors(filename: string): Promise<string[]> {
		// Preprocess and compile like esbuild.config.mjs does.
		const source = readFileSync(filename, "utf8");
		const { code } = await preprocess(source, sveltePreprocess(), { filename });
		const options = { ...svelteCompilerOptions, filename };
		const { css } = compile(code, { ...options, css: "external" });
		if (!css) return [];

		const styleId = compile(code, options).js.code.match(
			/hash: '(svelte-[a-z0-9]+)'/,
		)?.[1];
		if (!styleId) throw new Error(`No injected style id for ${filename}`);
		const scoped = new RegExp(`\\.${styleId}(?![\\w-])`);

		const offenders: string[] = [];
		const visit = (nodes: AST.CSS.StyleSheetFile["children"]) => {
			for (const node of nodes) {
				if (node.type === "Rule") {
					for (const selector of node.prelude.children) {
						const text = css.code.slice(selector.start, selector.end);
						if (!scoped.test(text)) offenders.push(`${filename}: ${text}`);
					}
				} else if (node.block && node.name !== "keyframes") {
					visit(node.block.children as AST.CSS.StyleSheetFile["children"]);
				}
			}
		};
		visit(parseCss(css.code).children);
		return offenders;
	}

	it("keeps every rule of every QuickAdd component under its scoped class", async () => {
		const components = readdirSync("src", { recursive: true, encoding: "utf8" })
			.filter((file) => file.endsWith(".svelte"))
			.map((file) => join("src", file))
			.sort();
		expect(components.length).toBeGreaterThan(0);

		const offenders: string[] = [];
		for (const file of components) {
			offenders.push(...(await unscopedSelectors(file)));
		}
		expect(
			offenders,
			"These rules would keep applying after an update; scope them to an element of the component, or move them to src/styles.css",
		).toEqual([]);
	}, 30_000);

	it("reports the file and selector of a rule that escapes the component", async () => {
		const fixture = join("tests", "fixtures", "UnanchoredGlobal.svelte");
		expect(await unscopedSelectors(fixture)).toEqual([`${fixture}: body`]);
	});
});
