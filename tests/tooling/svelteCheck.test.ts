import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

// module.registerHooks, which the preload below uses, arrived in Node 22.15.
it.skipIf(typeof module.registerHooks !== "function")("fails Svelte checking on a type error when the native TypeScript executable cannot run", () => {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const workspace = mkdtempSync(join(tmpdir(), "quickadd-svelte-check-native-"));
	try {
		symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir");
		copyFileSync(join(root, "svelte.config.mjs"), join(workspace, "svelte.config.mjs"));
		writeFileSync(join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", lib: ["DOM", "ES2022"], strict: true, skipLibCheck: true }, include: ["*.ts"] }));
		writeFileSync(join(workspace, "entry.ts"), 'export { default as Probe } from "./Probe.svelte";');
		writeFileSync(join(workspace, "Probe.svelte"), '<script lang="ts">const n: number = "wrong";</script><p>{n}</p>');
		// The native compiler's launcher resolves its platform package at startup, so this
		// reproduces an install without that package in every Node process the check starts.
		writeFileSync(join(workspace, "no-native-typescript.mjs"), [
			'import { registerHooks } from "node:module";',
			'registerHooks({ resolve: (specifier, context, next) => { if (specifier.startsWith("@typescript/typescript-")) throw new Error(`Cannot find package ${specifier}`); return next(specifier, context); } });',
		].join("\n"));
		const env = { ...process.env, NODE_OPTIONS: `--import ${pathToFileURL(join(workspace, "no-native-typescript.mjs")).href}` };

		const nativeTsc = spawnSync(process.execPath, [join(root, "node_modules/@typescript/native/bin/tsc"), "--version"], { cwd: workspace, encoding: "utf8", env, timeout: 30_000 });
		expect(nativeTsc.status).not.toBe(0);
		expect(nativeTsc.stderr).toContain("Unable to resolve @typescript/typescript-");

		const manifest: { scripts: { check: string } } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		const check = spawnSync(process.execPath, [join(root, "node_modules/svelte-check/bin/svelte-check"), ...manifest.scripts.check.split(" ").slice(1), "--output", "machine-verbose"], { cwd: workspace, encoding: "utf8", env, timeout: 30_000 });
		expect(check.error).toBeUndefined();
		expect(check.status, check.stdout + check.stderr).toBe(1);
		expect(check.stdout).toContain('"Probe.svelte"');
		expect(check.stdout).toContain('"code":2322');
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
}, 30_000);
