import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

function tsconfig(include: string[]): string {
	return JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", lib: ["DOM", "ES2022"], strict: true, skipLibCheck: true }, include });
}

function withWorkspace(files: Record<string, string>, run: (workspace: string) => void): void {
	const workspace = mkdtempSync(join(tmpdir(), "quickadd-svelte-check-"));
	try {
		symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir");
		copyFileSync(join(root, "svelte.config.mjs"), join(workspace, "svelte.config.mjs"));
		for (const [name, text] of Object.entries(files)) writeFileSync(join(workspace, name), text);
		run(workspace);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
}

function runCheck(workspace: string, env: NodeJS.ProcessEnv = process.env) {
	const { scripts }: { scripts: { check: string } } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const result = spawnSync(process.execPath, [join(root, "node_modules/svelte-check/bin/svelte-check"), ...scripts.check.split(" ").slice(1), "--output", "machine-verbose"], { cwd: workspace, encoding: "utf8", env, timeout: 30_000 });
	expect(result.error).toBeUndefined();
	return result;
}

it("fails strict Svelte checking on warnings, invalid handler types, and legacy reactivity", () => {
	withWorkspace({
		"tsconfig.json": tsconfig(["*.svelte"]),
		"accessibility.svelte": "<div onclick={() => {}}>X</div>",
		"unused-css.svelte": "<p>X</p><style>.unused { color: red; }</style>",
		"handler.svelte": '<script lang="ts">const {handler}: {handler: number} = $props();</script><button onclick={handler}>X</button>',
		"legacy.svelte": "<script>let n = 1; $: n = n + 1;</script>{n}",
	}, workspace => {
		const result = runCheck(workspace);
		expect(result.status, result.stderr).toBe(1);
		for (const filename of ["accessibility.svelte", "unused-css.svelte", "handler.svelte", "legacy.svelte"]) expect(result.stdout).toContain(filename);
		expect(result.stdout).toContain("a11y_click_events_have_key_events");
		expect(result.stdout).toContain("css_unused_selector");
		expect(result.stdout).toContain("legacy_reactive_statement_invalid");
		expect(result.stdout).toContain("2322");
	});
}, 30_000);

// module.registerHooks, which the preload below uses, arrived in Node 22.15.
it.skipIf(typeof module.registerHooks !== "function")("fails Svelte checking on a type error when the native TypeScript executable cannot run", () => {
	withWorkspace({
		"tsconfig.json": tsconfig(["*.ts"]),
		"entry.ts": 'export { default as Probe } from "./Probe.svelte";',
		"Probe.svelte": '<script lang="ts">const n: number = "wrong";</script><p>{n}</p>',
		// The native compiler's launcher resolves its platform package at startup, so this
		// reproduces an install without that package in every Node process the check starts.
		"no-native-typescript.mjs": [
			'import { registerHooks } from "node:module";',
			'registerHooks({ resolve: (specifier, context, next) => { if (specifier.startsWith("@typescript/typescript-")) throw new Error(`Cannot find package ${specifier}`); return next(specifier, context); } });',
		].join("\n"),
	}, workspace => {
		const preload = `--import ${pathToFileURL(join(workspace, "no-native-typescript.mjs")).href}`;
		const env = { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, preload].filter(Boolean).join(" ") };

		const nativeTsc = spawnSync(process.execPath, [join(root, "node_modules/@typescript/native/bin/tsc"), "--version"], { cwd: workspace, encoding: "utf8", env, timeout: 30_000 });
		expect(nativeTsc.status).not.toBe(0);
		expect(nativeTsc.stderr).toContain("Unable to resolve @typescript/typescript-");

		const check = runCheck(workspace, env);
		expect(check.status, check.stdout + check.stderr).toBe(1);
		expect(check.stdout).toContain('"Probe.svelte"');
		expect(check.stdout).toContain('"code":2322');
	});
}, 30_000);
