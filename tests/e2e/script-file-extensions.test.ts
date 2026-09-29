import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import type IMacroChoice from "../../src/types/choices/IMacroChoice";
import { CommandType } from "../../src/types/macros/CommandType";
import type { QuickAddPackage } from "../../src/types/packages/QuickAddPackage";
import { encodeToBase64 } from "../../src/utils/base64";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

// #1881: code runs only from .js files and notes, and the package import review
// asks you to read exactly the bundled files that can run.
const getContext = createQuickAddE2EHarness("script-file-extensions");

type RunResult = { ok: boolean; error?: string };

it("runs a user script only from a .js file or a note", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const script = (tag: string) =>
		`module.exports = () => { (window.__qaScriptExtRuns ??= []).push(${JSON.stringify(tag)}); };`;
	const js = await seedVaultFile(obsidian, sandbox, "scripts/run.js", script("js"));
	const txt = await seedVaultFile(obsidian, sandbox, "scripts/run.txt", script("txt"));
	const base = await seedVaultFile(obsidian, sandbox, "scripts/run.base", script("base"));
	const macro = (name: string, path: string): IMacroChoice => ({
		id: `qa-script-ext-${name}`,
		name: `Script ext ${name}`,
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: `qa-script-ext-${name}-body`,
			name,
			commands: [{ id: `qa-script-ext-${name}-cmd`, name: path, type: CommandType.UserScript, path, settings: {} }],
		},
	} as IMacroChoice);
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [macro("js", js), macro("txt", txt), macro("base", base)];
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJson("(() => { window.__qaScriptExtRuns = []; return true; })()");

	try {
		const run = (name: string) =>
			obsidian.execJson<RunResult>("quickadd:run", { choice: `Script ext ${name}` });
		expect(await run("js")).toMatchObject({ ok: true });
		for (const [name, path] of [["txt", txt], ["base", base]]) {
			const result = await run(name);
			expect(result.ok).toBe(false);
			expect(result.error).toContain(`QuickAdd could not run ${path}`);
		}
		expect(await obsidian.dev.evalJson<string[]>("window.__qaScriptExtRuns")).toEqual(["js"]);
	} finally {
		await obsidian.dev.evalJson("delete window.__qaScriptExtRuns");
	}
});

it("asks you to review only the bundled files that can run", async () => {
	const { obsidian, sandbox } = getContext();
	const inlineScript = "```js quickadd\nreturn 1;\n```";
	const asset = (originalPath: string, content: string) => ({
		kind: "template" as const,
		originalPath,
		contentEncoding: "base64" as const,
		content: encodeToBase64(content),
	});
	const pkg: QuickAddPackage = {
		schemaVersion: 1,
		quickAddVersion: "2.29.0",
		createdAt: "2026-09-29T00:00:00.000Z",
		rootChoiceIds: [],
		choices: [],
		assets: [
			asset("Templates/Dashboard.base", "views:\n  - type: table\n    name: Books\n"),
			asset("scripts/helper.txt", "module.exports = () => {};"),
			asset("scripts/helper.js", "module.exports = () => {};"),
			asset("Templates/Scripted.base", `views:\n  - type: table\n    name: |\n      ${inlineScript.replace(/\n/g, "\n      ")}\n`),
			asset("Templates/Note.md", `Vault: ${inlineScript.replace(/\n/g, " ")}`),
		],
	};
	const packagePath = await seedVaultFile(obsidian, sandbox, "extensions.quickadd.json", JSON.stringify(pkg));

	const result = await obsidian.execJson<{ ok: boolean; preview?: { criticalScriptPaths: string[] } }>(
		"quickadd:package-preview",
		{ path: packagePath },
	);

	expect(result.ok).toBe(true);
	expect(result.preview?.criticalScriptPaths).toEqual([
		"scripts/helper.js",
		"Templates/Scripted.base",
		"Templates/Note.md",
	]);
});
