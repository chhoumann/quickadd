import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSvelte } from "svelte-policy";
import { compile } from "svelte/compiler";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const component = join(root, "src/Probe.svelte");
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
const template = (statement: string) => `<button onclick={(event) => { const el = event.currentTarget; ${statement} }}>Text</button>`;

describe("custom syntax guards without ESLint", () => {
	it("rejects the same ten TypeScript violations, accepts valid code, and excludes tests in Oxlint", () => {
		const workspace = mkdtempSync(join(tmpdir(), "quickadd-lint-"));
		try {
			mkdirSync(join(workspace, "src"));
			for (const file of [".oxlintrc.syntax.json", "svelte-policy.json"]) copyFileSync(join(root, file), join(workspace, file));
			symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir");
			for (const [name, statement] of Object.entries({ ...forbidden, ...permitted })) {
				writeFileSync(join(workspace, `src/${name}.ts`), `export function probe(el: HTMLElement): void { ${statement} }`);
			}
			writeFileSync(join(workspace, "src/excluded.test.ts"), 'document.createElement("div");');
			writeFileSync(join(workspace, "src/state.svelte.ts"), 'export { writable } from "svelte/store";');
			writeFileSync(join(workspace, "src/dispatcher.svelte.ts"), 'import { createEventDispatcher } from "svelte"; export const dispatch = createEventDispatcher();');
			writeFileSync(join(workspace, "src/debug.svelte.ts"), 'const value = 1; $inspect(value);');
			writeFileSync(join(workspace, "src/internal.ts"), 'import "svelte/internal/disclose-version";');
			writeFileSync(join(workspace, "src/internal.svelte.ts"), 'export * from "svelte/internal/client";');
			writeFileSync(join(workspace, "src/internal.test.ts"), 'export { mount } from "svelte/internal/client";');
			const result = spawnSync(process.execPath, [join(root, "node_modules/oxlint/bin/oxlint"), "-c", ".oxlintrc.syntax.json", "src", "--format", "json"], { cwd: workspace, encoding: "utf8", timeout: 30_000 });
			expect(result.error).toBeUndefined();
			expect(result.status, result.stderr).toBe(1);
			const output: { diagnostics: { filename: string; code: string; message: string; severity: string }[] } = JSON.parse(result.stdout);
			const custom = output.diagnostics.filter(item => item.code === "quickadd(restricted-syntax)");
			expect(custom).toHaveLength(10);
			for (const [name, statement] of Object.entries(forbidden)) {
				const diagnostic = custom.find(item => item.filename.endsWith(`${name}.ts`));
				expect(diagnostic).toBeDefined();
				expect(diagnostic?.message).toBe(checkSvelte(template(statement), component)[0].message);
			}
			const reported = (code: string) => output.diagnostics.filter(item => item.code === code).map(item => basename(item.filename)).sort();
			expect(reported("quickadd(no-svelte-store)")).toEqual(["state.svelte.ts"]);
			expect(reported("quickadd(runes-only)")).toEqual(["dispatcher.svelte.ts"]);
			expect(output.diagnostics.filter(item => item.code === "quickadd(no-inspect)").map(item => [basename(item.filename), item.severity])).toEqual([["debug.svelte.ts", "warning"]]);
			expect(reported("quickadd(no-svelte-internal)")).toEqual(["internal.svelte.ts", "internal.test.ts", "internal.ts"]);
			expect(output.diagnostics.filter(item => item.filename.includes("valid-") || item.filename.includes("excluded.test.ts"))).toEqual([]);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	});

	it("retains type-aware promise and string-timer checks through the inherited Oxlint config", () => {
		const workspace = mkdtempSync(join(tmpdir(), "quickadd-typed-lint-"));
		try {
			mkdirSync(join(workspace, "src"));
			for (const file of [".oxlintrc.json", ".oxlintrc.syntax.json", "svelte-policy.json"]) copyFileSync(join(root, file), join(workspace, file));
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
	it.each([
		["no-svelte-store", '<script>import { writable } from "svelte/store";</script>'],
		["runes-only", "<script>let n = 1; $: n = n + 1;</script>"],
		["runes-only", '<script>import { createEventDispatcher as dispatcher } from "svelte"; const dispatch = dispatcher();</script>'],
	])("rejects %s: %s", (rule, source) => {
		expect(checkSvelte(source, component).map(item => item.rule)).toContain(rule);
	});
	it("rejects console methods in templates with the logger message", () => {
		expect(checkSvelte("<button onclick={() => console.log('X')}>X</button>", component)).toMatchObject([
			{ rule: "no-console", message: "Use the logger utilities instead of console methods." },
		]);
	});
	it("uses compiler warnings for accessibility and unused CSS", () => {
		const inaccessible = compile("<div onclick={() => {}}>X</div>", { generate: false, runes: true });
		expect(inaccessible.warnings.map(item => item.code)).toContain("a11y_click_events_have_key_events");
		const unused = compile("<p>X</p><style>.unused { color: red; }</style>", { generate: false, runes: true });
		expect(unused.warnings.map(item => item.code)).toContain("css_unused_selector");
	});
});
