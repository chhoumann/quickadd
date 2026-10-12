import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import module from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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
		for (const [name, text] of Object.entries(files)) {
			mkdirSync(dirname(join(workspace, name)), { recursive: true });
			writeFileSync(join(workspace, name), text);
		}
		run(workspace);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
}

function scripts(): Record<string, string> {
	return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
}

function runCheck(workspace: string, env: NodeJS.ProcessEnv = process.env): { status: number | null; output: string; diagnostics: string[] } {
	const [bin, ...args] = scripts().check.split(" ");
	expect(bin).toBe("svelte-check");
	const result = spawnSync(process.execPath, [join(root, "node_modules/svelte-check/bin/svelte-check"), ...args, "--output", "machine-verbose"], { cwd: workspace, encoding: "utf8", env, timeout: 30_000 });
	expect(result.error).toBeUndefined();
	const diagnostics = result.stdout.split("\n").flatMap(line => {
		const json = /^\d+ (\{.*\})$/.exec(line)?.[1];
		if (!json) return [];
		const { filename, code }: { filename: string; code: string | number } = JSON.parse(json);
		return [`${basename(filename)} ${code}`];
	});
	return { status: result.status, output: result.stdout + result.stderr, diagnostics };
}

// Every Node process the check starts loads this preload. It points the native compiler's
// launcher at `packageJson` for its platform package, or makes that package unresolvable.
function nativeCompilerEnv(workspace: string, packageJson: string | null): NodeJS.ProcessEnv {
	const hook = join(workspace, `native-compiler-${packageJson ? "fake" : "missing"}.mjs`);
	writeFileSync(hook, [
		'import { registerHooks } from "node:module";',
		`const packageJson = ${JSON.stringify(packageJson && pathToFileURL(packageJson).href)};`,
		"registerHooks({ resolve: (specifier, context, next) => {",
		'\tif (!specifier.startsWith("@typescript/typescript-")) return next(specifier, context);',
		"\tif (!packageJson) throw new Error(`Cannot find package ${specifier}`);",
		"\treturn { url: packageJson, shortCircuit: true };",
		"} });",
	].join("\n"));
	const preload = `--import ${pathToFileURL(hook).href}`;
	return { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, preload].filter(Boolean).join(" ") };
}

it("fails Svelte checking on compiler warnings", () => {
	withWorkspace({
		"tsconfig.json": tsconfig(["*.svelte"]),
		"accessibility.svelte": "<div onclick={() => {}}>X</div>",
		"unused-css.svelte": "<p>X</p><style>.unused { color: red; }</style>",
	}, workspace => {
		const { status, output, diagnostics } = runCheck(workspace);
		expect(status, output).toBe(1);
		expect(diagnostics).toEqual(expect.arrayContaining([
			"accessibility.svelte a11y_click_events_have_key_events",
			"unused-css.svelte css_unused_selector",
		]));
	});
}, 30_000);

it("fails Svelte checking on type errors, legacy reactivity, broken components, and missing components", () => {
	withWorkspace({
		"tsconfig.json": tsconfig(["*.ts", "*.svelte"]),
		"handler.svelte": '<script lang="ts">const {handler}: {handler: number} = $props();</script><button onclick={handler}>X</button>',
		"legacy.svelte": "<script>let n = 1; $: n = n + 1;</script>{n}",
		"unclosed.svelte": "{#if true}<p>X</p>",
		"entry.ts": 'export { default as Deleted } from "./Deleted.svelte";',
	}, workspace => {
		const { status, output, diagnostics } = runCheck(workspace);
		expect(status, output).toBe(1);
		expect(diagnostics).toEqual(expect.arrayContaining([
			"handler.svelte 2322",
			"legacy.svelte legacy_reactive_statement_invalid",
			"unclosed.svelte block_unclosed",
			"entry.ts 2307",
		]));
	});
}, 30_000);

// module.registerHooks, which the preload uses, arrived in Node 22.15.
it.skipIf(typeof module.registerHooks !== "function")("fails Svelte checking when the native TypeScript compiler cannot run or crashes", () => {
	const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}`;
	withWorkspace({
		"tsconfig.json": tsconfig(["*.ts"]),
		"entry.ts": 'export { default as Probe } from "./Probe.svelte";',
		"Probe.svelte": '<script lang="ts">const n: number = 1;</script><p>{n}</p>',
	}, workspace => {
		const clean = runCheck(workspace);
		expect(clean.status, clean.output).toBe(0);

		const missing = runCheck(workspace, nativeCompilerEnv(workspace, null));
		expect(missing.status, missing.output).toBe(1);
		expect(missing.output).toContain(`Unable to resolve ${platformPackage}`);

		// A shell script cannot stand in for tsc.exe.
		if (process.platform === "win32") return;
		const fake = join(workspace, "fake-native");
		mkdirSync(join(fake, "lib"), { recursive: true });
		writeFileSync(join(fake, "package.json"), JSON.stringify({ name: platformPackage }));
		writeFileSync(join(fake, "lib/tsc"), '#!/bin/sh\n: > "$0.started"\nkill -KILL $$\n');
		chmodSync(join(fake, "lib/tsc"), 0o755);
		const crashed = runCheck(workspace, nativeCompilerEnv(workspace, join(fake, "package.json")));
		expect(existsSync(join(fake, "lib/tsc.started")), crashed.output).toBe(true);
		expect(crashed.status, crashed.output).toBe(1);
		expect(crashed.output).not.toContain("COMPLETED");
	});
}, 60_000);

// svelte-check's native API path reports a clean run when the tsconfig matches no input files.
it("fails the tsconfig check in lint when the tsconfig matches no input files", () => {
	withWorkspace({
		"tsconfig.json": tsconfig(["missing/*.ts"]),
		"entry.ts": 'export const n: number = "wrong";',
	}, workspace => {
		const gate = new RegExp(/"\/(.+)\/"/.exec(scripts().lint)?.[1] ?? "$^");
		expect(["lint:tsconfig", "check"].filter(name => gate.test(name))).toEqual(["lint:tsconfig", "check"]);
		const [bin, ...args] = scripts()["lint:tsconfig"].split(" ");
		expect(bin).toBe("tsc");
		const result = spawnSync(process.execPath, [join(root, "node_modules/@typescript/native/bin/tsc"), ...args], { cwd: workspace, encoding: "utf8", timeout: 30_000 });
		expect(result.status, result.stdout + result.stderr).not.toBe(0);
		expect(result.stdout).toContain("TS18003");
	});
}, 30_000);
