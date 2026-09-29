import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { UserScript } from "../../src/types/macros/UserScript";
import type { QuickAddPackage } from "../../src/types/packages/QuickAddPackage";
import { encodeToBase64 } from "../../src/utils/base64";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral } from "./uiHelpers";

// #1881: code runs only from .js files and notes, and the package import review
// asks you to read exactly the bundled files that can run.
const getContext = createQuickAddE2EHarness("script-file-extensions");

type RunResult = { ok: boolean; error?: string };

it("runs a user script only from a .js file or a note", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const script = (tag: string) =>
		`module.exports = () => { (window.__qaScriptExtRuns ??= []).push(${jsLiteral(tag)}); };`;
	const js = await seedVaultFile(obsidian, sandbox, "scripts/run.js", script("js"));
	const txt = await seedVaultFile(obsidian, sandbox, "scripts/run.txt", script("txt"));
	const base = await seedVaultFile(obsidian, sandbox, "scripts/run.base", script("base"));
	const macro = (name: string, path: string) => {
		const choice = new MacroChoice(`Script ext ${name}`);
		choice.macro.commands.push(new UserScript(path, path));
		return choice;
	};
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

it("gates inline JavaScript written into a choice's settings", async () => {
	const { obsidian, sandbox } = getContext();
	const capture = (id: string, format: string) => ({
		choice: { id, name: id, type: "Capture", command: false, captureTo: "Inbox.md", format: { enabled: true, format } },
		pathHint: [id],
		parentChoiceId: null,
	});
	const pkg = (format: string) => ({
		schemaVersion: 1,
		quickAddVersion: "2.29.0",
		createdAt: "2026-09-29T00:00:00.000Z",
		rootChoiceIds: ["qa-inline"],
		choices: [capture("qa-inline", format)],
		assets: [],
	});
	type Preview = {
		ok: boolean;
		preview?: {
			summary: { hasCritical: boolean };
			capabilityRows: Array<{ flag: string; detail: string }>;
			choices: Array<{ inlineScripts: Array<{ setting: string; text: string }> }>;
		};
	};
	const preview = async (name: string, format: string) => {
		const path = await seedVaultFile(obsidian, sandbox, name, JSON.stringify(pkg(format)));
		return obsidian.execJson<Preview>("quickadd:package-preview", { path });
	};

	const format = "- ```js quickadd return app.vault.getName()```";
	const inline = await preview("inline.quickadd.json", format);
	expect(inline.preview?.summary.hasCritical).toBe(true);
	expect(inline.preview?.capabilityRows).toContainEqual(
		expect.objectContaining({ flag: "user-script", detail: "qa-inline › capture format" }),
	);
	// #1912: the review can show the code it gates on.
	expect(inline.preview?.choices[0]?.inlineScripts).toEqual([{ setting: "capture format", text: format }]);

	const plain = await preview("plain.quickadd.json", "- {{DATE:HH:mm}} {{VALUE}} <% tp.date.now() %>");
	expect(plain.preview?.summary.hasCritical).toBe(false);
});
