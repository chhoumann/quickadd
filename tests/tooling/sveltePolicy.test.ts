import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";
import { describe, expect, it } from "vitest";
import { checkSvelte } from "../../tooling/svelte-policy.mjs";

const forbidden = {
	"create-element": 'document.createElement("div");',
	"create-fragment": "document.createDocumentFragment();",
	"create-div": 'createEl("div");',
	"cross-window": "void (el instanceof HTMLElement);",
	"slider-tooltip": "el.setDynamicTooltip();",
	"lookbehind": "void /(?<=a)b/;",
	"style-property": 'el.style.color = "red";',
	"style-set-property": 'el.style.setProperty("color", "red");',
	"style-attribute": 'el.setAttribute("style", "color: red");',
	"style-helper": 'el.setCssStyles({ "color": "red" });',
};
const permitted = {
	"valid-helper": "el.createDiv();",
	"valid-window": "el.instanceOf(HTMLElement);",
	"valid-css-variable": 'el.setCssProps({ "--color": "red" });',
	"valid-dynamic-style": 'el.style.color = el.dataset.color ?? "";',
	"valid-forward-regex": "void /a(?=b)/;",
};
const contexts = {
	script: (statement: string) => `<script lang="ts">function probe(el: HTMLElement): void { ${statement} }</script>`,
	template: (statement: string) => `<button onclick={(event) => { const el = event.currentTarget; ${statement} }}>Text</button>`,
};

describe("custom syntax guards without ESLint", () => {
	for (const [context, component] of Object.entries(contexts)) {
		it.each(Object.entries(forbidden))(`rejects %s in a Svelte ${context}`, (_name, statement) => {
			const diagnostics = checkSvelte(component(statement));
			expect(diagnostics.filter(item => item.rule === "restricted-syntax")).toHaveLength(1);
		});
		it.each(Object.entries(permitted))(`accepts %s in a Svelte ${context}`, (_name, statement) => {
			expect(checkSvelte(component(statement))).toEqual([]);
		});
	}

	it("rejects the same ten TypeScript violations, accepts valid code, and excludes tests in Oxlint", () => {
		const root = fileURLToPath(new URL("../../", import.meta.url));
		const workspace = mkdtempSync(join(tmpdir(), "quickadd-lint-"));
		try {
			mkdirSync(join(workspace, "src"));
			mkdirSync(join(workspace, "tooling"));
			copyFileSync(join(root, ".oxlintrc.syntax.json"), join(workspace, ".oxlintrc.syntax.json"));
			copyFileSync(join(root, "tooling/oxlint-plugin.mjs"), join(workspace, "tooling/oxlint-plugin.mjs"));
			symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir");
			for (const [name, statement] of Object.entries({ ...forbidden, ...permitted })) {
				writeFileSync(join(workspace, `src/${name}.ts`), `export function probe(el: HTMLElement): void { ${statement} }`);
			}
			writeFileSync(join(workspace, "src/excluded.test.ts"), 'document.createElement("div");');
			writeFileSync(join(workspace, "src/state.svelte.ts"), 'export { writable } from "svelte/store";');
			writeFileSync(join(workspace, "src/debug.svelte.ts"), 'const value = 1; $inspect(value);');
			writeFileSync(join(workspace, "src/internal.ts"), 'import "svelte/internal/disclose-version";');
			writeFileSync(join(workspace, "src/internal.svelte.ts"), 'export * from "svelte/internal/client";');
			writeFileSync(join(workspace, "src/internal.test.ts"), 'export { mount } from "svelte/internal/client";');
			const result = spawnSync(process.execPath, [join(root, "node_modules/oxlint/bin/oxlint"), "-c", ".oxlintrc.syntax.json", "src", "--format", "json"], { cwd: workspace, encoding: "utf8", timeout: 30_000 });
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(1);
			const output: { diagnostics: { filename: string; code: string; message: string }[] } = JSON.parse(result.stdout);
			const custom = output.diagnostics.filter(item => item.code === "quickadd(restricted-syntax)");
			expect(custom).toHaveLength(10);
			for (const [name, statement] of Object.entries(forbidden)) {
				const diagnostic = custom.find(item => item.filename.endsWith(`${name}.ts`));
				expect(diagnostic).toBeDefined();
				expect(diagnostic?.message).toBe(checkSvelte(contexts.template(statement))[0].message);
			}
			expect(output.diagnostics.filter(item => item.code === "quickadd(svelte-runes)").map(item => basename(item.filename))).toEqual(["state.svelte.ts"]);
			expect(output.diagnostics.filter(item => item.code === "quickadd(svelte-debug)")).toHaveLength(1);
			expect(output.diagnostics.filter(item => item.code === "quickadd(svelte-internal)").map(item => basename(item.filename)).sort()).toEqual(["internal.svelte.ts", "internal.test.ts", "internal.ts"]);
			expect(output.diagnostics.filter(item => item.filename.includes("valid-") || item.filename.includes("excluded.test.ts"))).toEqual([]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("retains type-aware promise and string-timer checks through the inherited Oxlint config", () => {
		const root = fileURLToPath(new URL("../../", import.meta.url));
		const workspace = mkdtempSync(join(tmpdir(), "quickadd-typed-lint-"));
		try {
			mkdirSync(join(workspace, "src"));
			mkdirSync(join(workspace, "tooling"));
			for (const file of [".oxlintrc.json", ".oxlintrc.syntax.json", "tooling/oxlint-plugin.mjs"]) copyFileSync(join(root, file), join(workspace, file));
			symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir");
			writeFileSync(join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", lib: ["DOM", "ES2022"], skipLibCheck: true }, include: ["src/**/*.ts"] }));
			writeFileSync(join(workspace, "src/floating.ts"), "Promise.resolve(1);");
			writeFileSync(join(workspace, "src/misused.ts"), "[1].forEach(async () => {});");
			writeFileSync(join(workspace, "src/timer.ts"), 'const code: string = "alert(1)"; setTimeout(code, 10);');
			writeFileSync(join(workspace, "src/valid.ts"), "void Promise.resolve(1); setTimeout(() => {}, 10);");
			writeFileSync(join(workspace, "src/excluded.test.ts"), "Promise.resolve(1);");
			const result = spawnSync(process.execPath, [join(root, "node_modules/oxlint/bin/oxlint"), "--type-aware", "src", "--format", "json"], { cwd: workspace, encoding: "utf8", timeout: 30_000 });
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(1);
			const output: { diagnostics: { filename: string; code: string }[] } = JSON.parse(result.stdout);
			expect(output.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
				"typescript(no-floating-promises)", "typescript(no-misused-promises)", "typescript(no-implied-eval)",
			]));
			expect(output.diagnostics.filter(item => item.filename.endsWith("valid.ts") || item.filename.endsWith("excluded.test.ts"))).toEqual([]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});
});

describe("Svelte template policies", () => {
	const invalid = [
		["no-at-html-tags", "{@html html}"],
		["require-each-key", "{#each items as item}<p>{item}</p>{/each}"],
		["valid-each-key", "{#each items as item (42)}<p>{item}</p>{/each}"],
		["valid-each-key", "{#each items as item (obj.item)}<p>{item}</p>{/each}"],
		["valid-each-key", "{#each items as item ((item => item)(1))}<p>{item}</p>{/each}"],
		["valid-each-key", "{#each items as item ((function item() { return 42; })())}<p>{item}</p>{/each}"],
		["valid-each-key", "{#each items as item ((function item() { return item; })())}<p>{item}</p>{/each}"],
		["valid-each-key", "{#each items as item ((class item {}))}<p>{item}</p>{/each}"],
		["valid-each-key", "{#each items as item ((function key() { if (true) { var item = 42; } return item; })())}<p>{item}</p>{/each}"],
		["no-dom-manipulating", '<script>let el; function clear() { el.innerHTML = ""; }</script><div bind:this={el}></div>'],
		["no-dom-manipulating", "<script>let el; function clear() { el?.replaceChildren(); }</script><div bind:this={el}></div>"],
		["no-dom-manipulating", "<script context='module'>let el; function clear() { el.remove(); }</script><div bind:this={el}></div>"],
		["no-dupe-directives", "<div use:action use:action></div>"],
		["no-dupe-directives", "<button on:click={handler} on:click={handler}>X</button>"],
		["no-dupe-directives", "<button on:click|capture|once={handler} on:click|once|capture={handler}>X</button>"],
		["no-dupe-directives", "<button on:click={first || second} on:click={first || second}>X</button>"],
		["no-dupe-directives", "<button on:click={() => handle(1n)} on:click={() => handle(1n)}>X</button>"],
		["no-dupe-else-if-blocks", "{#if a || b}A{:else if b && c}B{/if}"],
		["no-dupe-else-if-blocks", "{#if a}A{:else if b}B{:else if a || b}C{/if}"],
		["no-dupe-else-if-blocks", "{#if status === 'ready'}A{:else if status === 'ready'}B{/if}"],
		["no-dupe-else-if-blocks", "{#if value === 1n}A{:else if value === 1n}B{/if}"],
		["no-object-in-text-mustaches", "<p>{{name: 'value'}}</p>"],
		["no-raw-special-elements", "<window />"],
		["no-at-debug-tags", "{@debug value}"],
		["no-inspect", "<script>let n = $state(1); $inspect(n);</script>"],
		["runes-only", "<script>let n = 1; $: n = n + 1;</script>"],
		["restricted-syntax", '<script>import { writable } from "svelte/store";</script>'],
		["restricted-syntax", '<script>import { effect } from "svelte/internal/client";</script>'],
		["restricted-syntax", '<script>void import("svelte/internal/client");</script>'],
		["restricted-syntax", '<script>import { createEventDispatcher as dispatcher } from "svelte"; const dispatch = dispatcher();</script>'],
		["no-console", "<button onclick={() => console.log('X')}>X</button>"],
		["no-console", "<script context='module'>console.log('X');</script><script>const console = {log() {}};</script>"],
		["no-console", "{#await value then console}<p>{console.log('X')}</p>{:catch error}<p>{console.log('X')}</p>{/await}"],
		["no-console", "{#each console.log('X') as console (console.id)}<p>{console.id}</p>{/each}"],
		["no-console", "{#each items as console (console.id)}<p>{console.id}</p>{:else}<p>{console.log('X')}</p>{/each}"],
		["no-console", "{#each items as item, console (item.id)}<p>{item.id}</p>{:else}<p>{console.log('X')}</p>{/each}"],
		["no-console", "<button onclick={() => { function inner() { var console = {log() {}}; } console.log('X'); }}>X</button>"],
		["no-console", "<script>function run(value = console.log('X')) { var console = {log() {}}; }</script>"],
		["no-console", "<Component let:console config={console.log('X')}><p>{console.log('X')}</p></Component>"],
		["no-console", "<script>class Local { static { var console = {log() {}}; } } console.log('X');</script>"],
		["no-console", "<button onclick={() => { switch (console.log('X')) { case 1: const console = {log() {}}; console.log('X'); } }}>X</button>"],
		["no-console", "<button onclick={() => { switch (1) { case 1: { const console = {log() {}}; break; } default: console.log('X'); } }}>X</button>"],
		["no-new-func", "<button onclick={() => new Function('return 1')()}>X</button>"],
		["no-new-func", "<button onclick={() => Function('return 1')()}>X</button>"],
		["no-implied-eval", "<button onclick={() => setTimeout('alert(1)', 10)}>X</button>"],
		["no-implied-eval", "<button onclick={() => window.setInterval('alert(1)', 10)}>X</button>"],
		["no-implied-eval", "<button onclick={() => globalThis['setTimeout']('alert(1)', 10)}>X</button>"],
		["no-implied-eval", "<button onclick={() => self.setTimeout(`alert(1)`, 10)}>X</button>"],
		["no-implied-eval", "<button onclick={() => global.setTimeout('alert(1)', 10)}>X</button>"],
		["no-implied-eval", "<button onclick={() => execScript('alert(1)')}>X</button>"],
		["no-unused-svelte-ignore", "<!-- svelte-ignore a11y_click_events_have_key_events --><p>X</p>"],
		["no-unused-svelte-ignore", "<!-- svelte-ignore a11y_no_static_element_interactions --><div></div><div onclick={() => {}}>X</div>"],
	];
	it.each(invalid)("rejects %s: %s", (rule, source) => {
		expect(checkSvelte(source).map(item => item.rule)).toContain(rule);
	});
	it.each([
		"{#each items as item (item.id)}<p>{item.name}</p>{/each}",
		"{#each items as {id, name} (id)}<p>{name}</p>{/each}",
		"{#each items as item, i (i)}<p>{item}</p>{/each}",
		"{#each items as item ((function key() { return item.id; })())}<p>{item}</p>{/each}",
		"{#each items as item ((function key() { function inner() { var item = 42; } return item.id; })())}<p>{item}</p>{/each}",
		"{#if a}A{:else if b}B{/if}",
		"{#if a}{#if a}A{/if}{/if}",
		"{#if next()}A{:else if next()}B{/if}",
		"{#if a && next()}A{:else if a && next()}B{/if}",
		"{#if object.ready}A{:else if object.ready}B{/if}",
		"{#if i++}A{:else if i++}B{/if}",
		"{#if (a = next())}A{:else if (a = next())}B{/if}",
		"{#if a < b}A{:else if a < b}B{/if}",
		"{#if a}A{:else if next()}B{:else if a}C{/if}",
		"<Component config={{name: 'value'}} />",
		"<button on:click|capture={handler} on:click={handler}>X</button>",
		"<button on:click={first || second} on:click={second || first}>X</button>",
		"<button on:click={first && second} on:click={second && first}>X</button>",
		"<div use:action={first || second} use:action={second || first}></div>",
		"<button on:click={() => handle(1n)}>X</button>",
		"<button on:click={() => handle(1n)} on:click={() => handle(2n)}>X</button>",
		"<button on:click={() => handle(1n)} on:click={() => handle('1')}>X</button>",
		"{#if value === 1n}A{:else if value === 1}B{/if}",
		"<script>let el; function clear(el) { el.remove(); }</script><div bind:this={el}></div>",
		"<script>let el; function clear() { const el = {}; el.remove(); }</script><div bind:this={el}></div>",
		"<script>let el; const clear = function el() { el.remove(); };</script><div bind:this={el}></div>",
		"<script context='module'>const el = {remove() {}}; el.remove();</script><script>let el;</script><div bind:this={el}></div>",
		"<script>let el; function inspect() { return el.textContent; }</script><div bind:this={el}></div>",
		"<button onclick={() => setTimeout(() => {}, 10)}>X</button>",
		"<button onclick={() => console.error('X')}>X</button>",
		"<button onclick={(console) => console.log('X')}>X</button>",
		"<script>function run(Function) { return Function('value'); }</script>",
		"<script>function run(Function) { return new Function('value'); }</script>",
		"<script>function run() { const console = {log() {}}; console.log('X'); }</script>",
		"<button onclick={() => { if (true) { var console = {log() {}}; } console.log('X'); }}>X</button>",
		"<button onclick={() => { if (true) { var Function = value => value; } Function('value'); }}>X</button>",
		"<button onclick={() => { if (true) { var setTimeout = value => value; } setTimeout('short'); }}>X</button>",
		"<script>if (true) { var console = {log() {}}; } console.log('X');</script>",
		"<script>class Local { static { var console = {log() {}}; console.log('X'); } }</script>",
		"<Component let:console><p>{console.log('X')}</p></Component>",
		"<Component let:logger={console}><p>{console.log('X')}</p></Component>",
		"<Component let:logger={{log: console}}><p>{console.log('X')}</p></Component>",
		"<button onclick={() => { switch (1) { case 1: const console = {log() {}}; console.log('X'); break; } }}>X</button>",
		"<script>const console = {log() {}}; console.log('X');</script>",
		"<script>import console from './logger';</script><button onclick={() => console.log('X')}>X</button>",
		"<script>export const Function = value => value;</script><button onclick={() => Function('value')}>X</button>",
		"<script context='module'>const console = {log() {}}; console.log('X');</script>",
		"<script context='module'>const console = {log() {}};</script><script>console.log('X');</script>",
		"{#each entries as console (console.id)}<p>{console.log('X')}</p>{/each}",
		"{#snippet render(console)}<p>{console.log('X')}</p>{/snippet}",
		"{#await value then console}<p>{console.log('X')}</p>{/await}",
		"{#await value}<p>Waiting</p>{:catch Function}<p>{Function('value')}</p>{/await}",
		"{#if ready}{@const console = logger}<p>{console.log('X')}</p>{/if}",
		"<button onclick={() => settings.setTimeout('short')}>X</button>",
		"<button onclick={() => settings['setInterval']('short')}>X</button>",
		"<button onclick={(setTimeout) => setTimeout('short')}>X</button>",
		"<button onclick={(window) => window.setTimeout('short')}>X</button>",
		"<script>const setTimeout = value => value;</script><button onclick={() => setTimeout('short')}>X</button>",
		"<button onclick={() => window.setTimeout(() => {}, 10)}>X</button>",
		"<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions --><div onclick={() => {}}>X</div>",
		"<!-- svelte-ignore a11y_click_events_have_key_events --><!-- svelte-ignore a11y_no_static_element_interactions --><div onclick={() => {}}>X</div>",
	])("accepts valid template code: %s", source => {
		expect(checkSvelte(source)).toEqual([]);
	});
	it("reports template expressions at their original line and column", () => {
		const [diagnostic] = checkSvelte("<p>Text</p>\n<button onclick={() => document.createElement('div')}>X</button>", "Probe.svelte");
		expect(diagnostic).toMatchObject({ filename: "Probe.svelte", line: 2, column: 24, rule: "restricted-syntax" });
	});
	it("rejects malformed components instead of skipping them", () => {
		expect(checkSvelte("{#if ready}<p>X</p>")).toMatchObject([{ severity: "error" }]);
	});
	it("uses compiler warnings for accessibility and unused CSS", () => {
		const inaccessible = compile("<div onclick={() => {}}>X</div>", { generate: false, runes: true });
		expect(inaccessible.warnings.map(item => item.code)).toContain("a11y_click_events_have_key_events");
		const unused = compile("<p>X</p><style>.unused { color: red; }</style>", { generate: false, runes: true });
		expect(unused.warnings.map(item => item.code)).toContain("css_unused_selector");
	});
	it("fails strict Svelte checking on warnings, invalid handler types, and legacy reactivity", () => {
		const root = fileURLToPath(new URL("../../", import.meta.url));
		const workspace = mkdtempSync(join(tmpdir(), "quickadd-svelte-check-"));
		try {
			symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir");
			copyFileSync(join(root, "svelte.config.mjs"), join(workspace, "svelte.config.mjs"));
			writeFileSync(join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", lib: ["DOM", "ES2022"], strict: true, skipLibCheck: true }, include: ["*.svelte"] }));
			writeFileSync(join(workspace, "accessibility.svelte"), "<div onclick={() => {}}>X</div>");
			writeFileSync(join(workspace, "unused-css.svelte"), "<p>X</p><style>.unused { color: red; }</style>");
			writeFileSync(join(workspace, "handler.svelte"), '<script lang="ts">const {handler}: {handler: number} = $props();</script><button onclick={handler}>X</button>');
			writeFileSync(join(workspace, "legacy.svelte"), "<script>let n = 1; $: n = n + 1;</script>{n}");
			const manifest: { scripts: { check: string } } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
			const result = spawnSync(process.execPath, [join(root, "node_modules/svelte-check/bin/svelte-check"), ...manifest.scripts.check.split(" ").slice(1), "--output", "machine-verbose"], { cwd: workspace, encoding: "utf8", timeout: 30_000 });
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(1);
			for (const filename of ["accessibility.svelte", "unused-css.svelte", "handler.svelte", "legacy.svelte"]) expect(result.stdout).toContain(filename);
			expect(result.stdout).toContain("a11y_click_events_have_key_events");
			expect(result.stdout).toContain("css_unused_selector");
			expect(result.stdout).toContain("legacy_reactive_statement_invalid");
			expect(result.stdout).toContain("2322");
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	}, 30_000);
});
