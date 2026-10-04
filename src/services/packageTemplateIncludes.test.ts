import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { CommandType } from "../types/macros/CommandType";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type {
	QuickAddPackage,
	QuickAddPackageAsset,
	QuickAddPackageAssetKind,
} from "../types/packages/QuickAddPackage";
import { decodeFromBase64, encodeToBase64 } from "../utils/base64";
import { buildPackage } from "./packageExportService";
import {
	analysePackagePreview,
	applyPackageImport,
} from "./packageImportService";
import {
	buildPackagePreview,
	collectReferencedAssetPaths,
} from "./packagePreview";

/**
 * `{{TEMPLATE:...}}` includes across the package lifecycle: export bundles
 * them, the preview attributes them, and import follows them to wherever the
 * included file was written.
 */

// --- Builders ---------------------------------------------------------------

function templateChoice(id: string, name: string, templatePath: string): ITemplateChoice {
	return {
		id,
		name,
		type: "Template",
		command: false,
		templatePath,
	} as ITemplateChoice;
}

function captureChoice(
	id: string,
	name: string,
	format: { enabled: boolean; format: string },
	template?: string,
): ICaptureChoice {
	return {
		id,
		name,
		type: "Capture",
		command: false,
		captureTo: "Inbox.md",
		captureToActiveFile: false,
		createFileIfItDoesntExist: {
			enabled: template !== undefined,
			createWithTemplate: template !== undefined,
			template: template ?? "",
		},
		format,
	} as ICaptureChoice;
}

function macroChoice(id: string, name: string, commands: unknown[]): IMacroChoice {
	return {
		id,
		name,
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: { id: `${id}-macro`, name, commands },
	} as IMacroChoice;
}

function userScript(id: string, path: string): IUserScript {
	return { id, name: path, type: CommandType.UserScript, path, settings: {} };
}

function nestedCapture(id: string, choice: ICaptureChoice): INestedChoiceCommand {
	return { id, name: choice.name, type: CommandType.NestedChoice, choice };
}

function asset(
	kind: QuickAddPackageAssetKind,
	originalPath: string,
	content: string,
): QuickAddPackageAsset {
	return { kind, originalPath, contentEncoding: "base64", content: encodeToBase64(content) };
}

function makePackage(
	choices: IChoice[],
	assets: QuickAddPackageAsset[],
): QuickAddPackage {
	return {
		schemaVersion: 1,
		quickAddVersion: "2.30.0",
		createdAt: "2026-09-01T00:00:00.000Z",
		rootChoiceIds: choices.map((choice) => choice.id),
		choices: choices.map((choice) => ({
			choice,
			pathHint: [choice.name],
			parentChoiceId: null,
		})),
		assets,
	};
}

function fakeApp(initialFiles: Record<string, string> = {}) {
	const files = new Map(Object.entries(initialFiles));
	const app = {
		vault: {
			configDir: ".obsidian",
			adapter: {
				exists: vi.fn(async (path: string) => files.has(path)),
				stat: vi.fn(async (path: string) => (files.has(path) ? { type: "file" } : null)),
				read: vi.fn(async (path: string) => {
					const content = files.get(path);
					if (content === undefined) throw new Error(`Missing file: ${path}`);
					return content;
				}),
				write: vi.fn(async (path: string, content: string) => {
					files.set(path, content);
				}),
			},
			createFolder: vi.fn(async () => { }),
		},
	} as unknown as App;
	return { app, files };
}

function assetPaths(pkg: QuickAddPackage): Record<string, QuickAddPackageAssetKind> {
	return Object.fromEntries(pkg.assets.map((a) => [a.originalPath, a.kind]));
}

const MOC_TEMPLATE = "# {{TITLE}}\n\n{{TEMPLATE:Templates/Dashboard.base}}\n";
const DASHBOARD_BASE = "views:\n  - type: table\n";

// --- Export -----------------------------------------------------------------

describe("buildPackage bundles {{TEMPLATE:}} includes", () => {
	it("bundles a Capture format's includes as templates", async () => {
		const capture = captureChoice("c1", "Insert dashboard", {
			enabled: true,
			format: "{{TEMPLATE:Templates/Dashboard.base}}\n",
		});
		const { app } = fakeApp({ "Templates/Dashboard.base": DASHBOARD_BASE });

		const { pkg, missingAssets } = await buildPackage(app, {
			choices: [capture],
			rootChoiceIds: ["c1"],
			quickAddVersion: "2.30.0",
		});

		expect(assetPaths(pkg)).toEqual({ "Templates/Dashboard.base": "template" });
		expect(missingAssets).toEqual([]);
	});

	it("skips the format's includes when the format is disabled", async () => {
		const capture = captureChoice("c1", "Plain", {
			enabled: false,
			format: "{{TEMPLATE:Templates/Dashboard.base}}",
		});
		const { app } = fakeApp({ "Templates/Dashboard.base": DASHBOARD_BASE });

		const { pkg } = await buildPackage(app, {
			choices: [capture],
			rootChoiceIds: ["c1"],
			quickAddVersion: "2.30.0",
		});

		expect(pkg.assets).toEqual([]);
	});

	it("bundles includes found inside bundled templates, transitively", async () => {
		const template = templateChoice("t1", "New MOC", "Templates/MOC.md");
		const { app } = fakeApp({
			"Templates/MOC.md": "{{TEMPLATE:Templates/Header.md}}\n{{template:Templates/Dashboard.base}}",
			"Templates/Header.md": "---\ntags: moc\n---\n{{TEMPLATE:Templates/Deep.md}}",
			"Templates/Deep.md": "deep",
			"Templates/Dashboard.base": DASHBOARD_BASE,
		});

		const { pkg, missingAssets } = await buildPackage(app, {
			choices: [template],
			rootChoiceIds: ["t1"],
			quickAddVersion: "2.30.0",
		});

		expect(assetPaths(pkg)).toEqual({
			"Templates/MOC.md": "template",
			"Templates/Header.md": "template",
			"Templates/Dashboard.base": "template",
			"Templates/Deep.md": "template",
		});
		expect(missingAssets).toEqual([]);
	});

	it("reports an include that does not exist in the vault as a missing asset", async () => {
		const template = templateChoice("t1", "New MOC", "Templates/MOC.md");
		const { app } = fakeApp({ "Templates/MOC.md": MOC_TEMPLATE });

		const { pkg, missingAssets } = await buildPackage(app, {
			choices: [template],
			rootChoiceIds: ["t1"],
			quickAddVersion: "2.30.0",
		});

		expect(Object.keys(assetPaths(pkg))).toEqual(["Templates/MOC.md"]);
		expect(missingAssets).toEqual([
			{ path: "Templates/Dashboard.base", kind: "template" },
		]);
	});

	it("does not read includes out of a script, even a Markdown note-script", async () => {
		const macro = macroChoice("m1", "Run", [userScript("s1", "Scripts/note-script.md")]);
		const { app } = fakeApp({
			"Scripts/note-script.md": "```js\nmodule.exports = () => '{{TEMPLATE:Templates/X.md}}';\n```",
			"Templates/X.md": "x",
		});

		const { pkg } = await buildPackage(app, {
			choices: [macro],
			rootChoiceIds: ["m1"],
			quickAddVersion: "2.30.0",
		});

		expect(Object.keys(assetPaths(pkg))).toEqual(["Scripts/note-script.md"]);
	});

	it("follows includes inside a bundled .base or .canvas template, which the formatter also renders", async () => {
		const template = templateChoice("t1", "Dashboard", "Templates/Dashboard.base");
		const { app } = fakeApp({
			"Templates/Dashboard.base": "summary: {{TEMPLATE:Templates/Summary.md}}\n",
			"Templates/Summary.md": "{{TEMPLATE:Boards/Board.canvas}}",
			"Boards/Board.canvas": '{"nodes":[{"text":"{{TEMPLATE:Templates/Deep.md}}"}]}',
			"Templates/Deep.md": "deep",
		});

		const { pkg, missingAssets } = await buildPackage(app, {
			choices: [template],
			rootChoiceIds: ["t1"],
			quickAddVersion: "2.30.0",
		});

		expect(Object.keys(assetPaths(pkg)).sort()).toEqual([
			"Boards/Board.canvas",
			"Templates/Dashboard.base",
			"Templates/Deep.md",
			"Templates/Summary.md",
		]);
		expect(missingAssets).toEqual([]);
	});

	it("matches an include written with a leading slash to the vault file it resolves to", async () => {
		const template = templateChoice("t1", "New MOC", "Templates/MOC.md");
		const { app } = fakeApp({
			"Templates/MOC.md": "{{TEMPLATE: /Templates/Dashboard.base}}",
			"Templates/Dashboard.base": DASHBOARD_BASE,
		});

		const { pkg, missingAssets } = await buildPackage(app, {
			choices: [template],
			rootChoiceIds: ["t1"],
			quickAddVersion: "2.30.0",
		});

		expect(assetPaths(pkg)).toEqual({
			"Templates/MOC.md": "template",
			"Templates/Dashboard.base": "template",
		});
		expect(missingAssets).toEqual([]);
	});

	it("terminates on templates that include each other", async () => {
		const template = templateChoice("t1", "Loop", "Templates/A.md");
		const { app } = fakeApp({
			"Templates/A.md": "{{TEMPLATE:Templates/B.md}}",
			"Templates/B.md": "{{TEMPLATE:Templates/A.md}}",
		});

		const { pkg } = await buildPackage(app, {
			choices: [template],
			rootChoiceIds: ["t1"],
			quickAddVersion: "2.30.0",
		});

		expect(Object.keys(assetPaths(pkg)).sort()).toEqual(["Templates/A.md", "Templates/B.md"]);
	});
});

// --- Preview ----------------------------------------------------------------

describe("package preview sees {{TEMPLATE:}} includes", () => {
	it("attributes a Capture format include to the capture and clears the orphan flag", () => {
		const capture = captureChoice("c1", "Insert dashboard", {
			enabled: true,
			format: "{{TEMPLATE:Templates/Dashboard.base}}",
		});
		const pkg = makePackage(
			[capture],
			[asset("template", "Templates/Dashboard.base", DASHBOARD_BASE)],
		);

		const preview = buildPackagePreview([], pkg, new Set());

		const file = preview.files[0];
		expect(file?.orphan).toBe(false);
		expect(file?.executable).toBe(false);
		// A Base holds no code QuickAdd runs, so it is not gated as a script (#1881).
		expect(file?.requiresReview).toBe(false);
		expect(file?.referencedBy).toEqual([
			{
				choiceId: "c1",
				path: "Templates/Dashboard.base",
				asScript: false,
				impliedKind: "template",
				breadcrumb: "Insert dashboard › {{TEMPLATE}} include",
			},
		]);
		expect(preview.orphanAssets).toEqual([]);
		expect(preview.missingReferences).toEqual([]);
	});

	it("flags an unbundled include that is not in the vault as a missing (non-script) reference", () => {
		const capture = captureChoice("c1", "Insert dashboard", {
			enabled: true,
			format: "{{TEMPLATE:Templates/Dashboard.base}}",
		});
		const pkg = makePackage([capture], []);

		const missing = buildPackagePreview([], pkg, new Set());
		expect(missing.missingReferences).toEqual([
			{
				path: "Templates/Dashboard.base",
				asScript: false,
				breadcrumb: "Insert dashboard › {{TEMPLATE}} include",
			},
		]);
		const row = missing.capabilityRows.find((r) => r.flag === "missing-reference");
		expect(row?.severity).toBe("warning");

		const present = buildPackagePreview([], pkg, new Set(["Templates/Dashboard.base"]));
		expect(present.missingReferences).toEqual([]);
	});

	it("follows includes inside a bundled template and attributes them to the using choice", () => {
		const template = templateChoice("t1", "New MOC", "Templates/MOC.md");
		const pkg = makePackage(
			[template],
			[
				asset("template", "Templates/MOC.md", "{{TEMPLATE:Templates/Header.md}}"),
				asset("template", "Templates/Header.md", "{{TEMPLATE:Templates/Dashboard.base}}"),
				asset("template", "Templates/Dashboard.base", DASHBOARD_BASE),
			],
		);

		expect(collectReferencedAssetPaths(pkg)).toEqual([
			"Templates/MOC.md",
			"Templates/Header.md",
			"Templates/Dashboard.base",
		]);

		const preview = buildPackagePreview([], pkg, new Set());
		expect(preview.orphanAssets).toEqual([]);
		const dashboard = preview.files.find((f) => f.originalPath === "Templates/Dashboard.base");
		expect(dashboard?.referencedBy).toEqual([
			{
				choiceId: "t1",
				path: "Templates/Dashboard.base",
				asScript: false,
				impliedKind: "template",
				breadcrumb: "New MOC › template › {{TEMPLATE}} include › {{TEMPLATE}} include",
			},
		]);
	});

	it("reports an include missing from a bundled template as a missing reference", () => {
		const template = templateChoice("t1", "New MOC", "Templates/MOC.md");
		const pkg = makePackage([template], [asset("template", "Templates/MOC.md", MOC_TEMPLATE)]);

		const preview = buildPackagePreview([], pkg, new Set());

		expect(preview.missingReferences.map((m) => m.path)).toEqual(["Templates/Dashboard.base"]);
		expect(preview.summary.missingCount).toBe(1);
	});

	it("sees includes in a capture embedded in a macro step", () => {
		const capture = captureChoice("c-inline", "Inline capture", {
			enabled: true,
			format: "{{TEMPLATE:Templates/Line.md}}",
		});
		const macro = macroChoice("m1", "Wrapper", [nestedCapture("n1", capture)]);
		const pkg = makePackage([macro], [asset("template", "Templates/Line.md", "- {{VALUE}}")]);

		const preview = buildPackagePreview([], pkg, new Set());

		expect(preview.orphanAssets).toEqual([]);
		expect(preview.files[0]?.referencedBy[0]?.choiceId).toBe("m1");
	});

	it("does not read includes out of a note that is only used as a script", () => {
		const macro = macroChoice("m1", "Run", [userScript("s1", "Scripts/note-script.md")]);
		const pkg = makePackage(
			[macro],
			[
				asset(
					"user-script",
					"Scripts/note-script.md",
					"```js\nmodule.exports = () => '{{TEMPLATE:Templates/X.md}}';\n```",
				),
			],
		);

		const preview = buildPackagePreview([], pkg, new Set());

		expect(collectReferencedAssetPaths(pkg)).toEqual(["Scripts/note-script.md"]);
		expect(preview.missingReferences).toEqual([]);
	});

	it("still walks a note used as a script once a template include reaches it", () => {
		// The macro's script reference comes first in the walk; the include
		// found inside the bundled template must not be shadowed by it.
		const macro = macroChoice("m1", "Run", [userScript("s1", "Notes/Shared.md")]);
		const template = templateChoice("t1", "New", "Templates/Entry.md");
		const pkg = makePackage(
			[macro, template],
			[
				asset("user-script", "Notes/Shared.md", "{{TEMPLATE:Templates/Nested.md}}"),
				asset("template", "Templates/Entry.md", "{{TEMPLATE:Notes/Shared.md}}"),
			],
		);

		const preview = buildPackagePreview([], pkg, new Set());

		expect(preview.missingReferences.map((ref) => ref.path)).toEqual([
			"Templates/Nested.md",
		]);
	});

	it("follows includes inside a bundled .base template", () => {
		const capture = captureChoice("c1", "Insert dashboard", {
			enabled: true,
			format: "{{TEMPLATE:Templates/Dashboard.base}}",
		});
		const pkg = makePackage(
			[capture],
			[
				asset(
					"template",
					"Templates/Dashboard.base",
					"summary: {{TEMPLATE:Templates/Summary.md}}\n",
				),
			],
		);

		const preview = buildPackagePreview([], pkg, new Set());

		expect(preview.missingReferences.map((ref) => ref.path)).toEqual([
			"Templates/Summary.md",
		]);
	});

	it("terminates on bundled templates that include each other", () => {
		const template = templateChoice("t1", "Loop", "Templates/A.md");
		const pkg = makePackage(
			[template],
			[
				asset("template", "Templates/A.md", "{{TEMPLATE:Templates/B.md}}"),
				asset("template", "Templates/B.md", "{{TEMPLATE:Templates/A.md}}"),
			],
		);

		const preview = buildPackagePreview([], pkg, new Set());
		expect(preview.orphanAssets).toEqual([]);
		expect(preview.missingReferences).toEqual([]);
	});

	it("probes include paths for existence during analysis", async () => {
		const template = templateChoice("t1", "New MOC", "Templates/MOC.md");
		const pkg = makePackage([template], [asset("template", "Templates/MOC.md", MOC_TEMPLATE)]);
		const { app } = fakeApp({ "Templates/Dashboard.base": DASHBOARD_BASE });

		const preview = await analysePackagePreview(app, [], pkg);

		expect(app.vault.adapter.exists).toHaveBeenCalledWith("Templates/Dashboard.base");
		expect(preview.missingReferences).toEqual([]);
	});

	it("warns about the file a backslash-spelled asset will overwrite", async () => {
		const pkg = makePackage(
			[macroChoice("m1", "Legacy", [])],
			[asset("user-script", "Scripts\\helper.js", "module.exports = () => 1;")],
		);
		const { app } = fakeApp({ "Scripts/helper.js": "module.exports = () => 0;" });

		const preview = await analysePackagePreview(app, [], pkg);

		expect(preview.files[0]?.exists).toBe(true);
		expect(preview.summary.overwritesFiles).toBe(1);
	});
});

// --- Import -----------------------------------------------------------------

describe("applyPackageImport follows {{TEMPLATE:}} includes to their destinations", () => {
	const capture = captureChoice(
		"c1",
		"New MOC section",
		{ enabled: true, format: "{{TEMPLATE:Templates/Section.md}}\n" },
		"Templates/MOC.md",
	);
	const template = templateChoice("t1", "New MOC", "Templates/MOC.md");
	const pkg = makePackage(
		[template, capture],
		[
			asset("template", "Templates/MOC.md", MOC_TEMPLATE),
			asset("template", "Templates/Section.md", "## {{VALUE}}\n{{TEMPLATE:Templates/Dashboard.base}}\n"),
			asset("template", "Templates/Dashboard.base", DASHBOARD_BASE),
		],
	);

	const redirected = (path: string) => `My Templates/${path.split("/").pop() ?? path}`;

	it("rewrites includes in written templates and capture formats to the chosen destinations", async () => {
		const { app, files } = fakeApp();

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [
				{ choiceId: "t1", mode: "import" },
				{ choiceId: "c1", mode: "import" },
			],
			assetDecisions: pkg.assets.map((a) => ({
				originalPath: a.originalPath,
				destinationPath: redirected(a.originalPath),
				mode: "write" as const,
			})),
		});

		expect(result.writtenAssets).toEqual([
			"My Templates/MOC.md",
			"My Templates/Section.md",
			"My Templates/Dashboard.base",
		]);
		expect(files.get("My Templates/MOC.md")).toBe(
			"# {{TITLE}}\n\n{{TEMPLATE:My Templates/Dashboard.base}}\n",
		);
		expect(files.get("My Templates/Section.md")).toBe(
			"## {{VALUE}}\n{{TEMPLATE:My Templates/Dashboard.base}}\n",
		);
		expect(files.get("My Templates/Dashboard.base")).toBe(DASHBOARD_BASE);

		const importedTemplate = result.updatedChoices[0] as ITemplateChoice;
		expect(importedTemplate.templatePath).toBe("My Templates/MOC.md");
		const importedCapture = result.updatedChoices[1] as ICaptureChoice;
		expect(importedCapture.format.format).toBe("{{TEMPLATE:My Templates/Section.md}}\n");
		expect(importedCapture.createFileIfItDoesntExist.template).toBe("My Templates/MOC.md");
	});

	it("rewrites an include written with backslashes when its asset is redirected", async () => {
		const { app, files } = fakeApp();
		const legacy = makePackage(
			[templateChoice("t2", "Legacy", "Templates\\Parent.md")],
			[
				asset("template", "Templates\\Parent.md", "# Parent\n{{TEMPLATE:Templates\\Part.md}}\n"),
				asset("template", "Templates\\Part.md", "part"),
			],
		);

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg: legacy,
			choiceDecisions: [{ choiceId: "t2", mode: "import" }],
			assetDecisions: legacy.assets.map((a) => ({
				originalPath: a.originalPath,
				destinationPath: redirected(a.originalPath.replace(/\\/g, "/")),
				mode: "write" as const,
			})),
		});

		expect(files.get("My Templates/Parent.md")).toBe(
			"# Parent\n{{TEMPLATE:My Templates/Part.md}}\n",
		);
		expect((result.updatedChoices[0] as ITemplateChoice).templatePath).toBe("My Templates/Parent.md");
	});

	it("normalizes script step paths on import, bundled or not, so the loader can resolve them", async () => {
		const { app } = fakeApp();
		const check = {
			id: "cond",
			name: "Check",
			type: CommandType.Conditional,
			condition: { mode: "script", scriptPath: "Scripts\\check.js" },
			thenCommands: [],
			elseCommands: [],
		};
		const pkg = makePackage(
			[
				macroChoice("m1", "Legacy", [
					userScript("s1", "Scripts\\run.js"),
					check,
					userScript("s2", " Scripts\\keep.js"),
					userScript("s3", " Scripts/run.js"),
				]),
			],
			[asset("user-script", "Scripts/run.js", "module.exports = () => 1;")],
		);

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [{ choiceId: "m1", mode: "import" }],
			assetDecisions: [{ originalPath: "Scripts/run.js", destinationPath: "Scripts/run.js", mode: "write" as const }],
		});

		const [script, cond, unbundled, spaced] = (result.updatedChoices[0] as IMacroChoice).macro.commands as [
			IUserScript,
			{ condition: { scriptPath: string } },
			IUserScript,
			IUserScript,
		];
		expect(script.path).toBe("Scripts/run.js");
		expect(script.name).toBe("Scripts/run.js");
		expect(cond.condition.scriptPath).toBe("Scripts/check.js");
		// A leading space names a real vault folder; only separators change.
		expect(unbundled.path).toBe(" Scripts/keep.js");
		// ...and never folds into the bundled "Scripts/run.js".
		expect(spaced.path).toBe(" Scripts/run.js");
	});

	it("leaves malformed non-string paths alone instead of aborting the import", async () => {
		const { app } = fakeApp();
		const broken = { ...userScript("s1", "Scripts/run.js"), path: 7 as unknown as string };
		const pkg = makePackage(
			[
				macroChoice("m1", "Broken", [broken]),
				{ ...templateChoice("t1", "Odd", "Templates/T.md"), templatePath: 7 as unknown as string } as ITemplateChoice,
			],
			[asset("user-script", "Scripts/run.js", "module.exports = () => 1;")],
		);

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [{ choiceId: "m1", mode: "import" }, { choiceId: "t1", mode: "import" }],
			assetDecisions: [{ originalPath: "Scripts/run.js", destinationPath: "Scripts/run.js", mode: "write" as const }],
		});

		const [macro, template] = result.updatedChoices as [IMacroChoice, ITemplateChoice];
		expect((macro.macro.commands[0] as IUserScript).path).toBe(7);
		expect(template.templatePath).toBe(7);
	});

	it("leaves includes alone when the included file keeps its path or is skipped", async () => {
		const { app, files } = fakeApp({ "Templates/Dashboard.base": "existing" });

		await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [
				{ choiceId: "t1", mode: "import" },
				{ choiceId: "c1", mode: "import" },
			],
			assetDecisions: [
				{ originalPath: "Templates/MOC.md", destinationPath: "My Templates/MOC.md", mode: "write" },
				{ originalPath: "Templates/Section.md", destinationPath: "Templates/Section.md", mode: "write" },
				{ originalPath: "Templates/Dashboard.base", destinationPath: "Templates/Dashboard.base", mode: "skip" },
			],
		});

		expect(files.get("My Templates/MOC.md")).toBe(MOC_TEMPLATE);
		expect(files.get("Templates/Section.md")).toBe(
			"## {{VALUE}}\n{{TEMPLATE:Templates/Dashboard.base}}\n",
		);
		expect(files.get("Templates/Dashboard.base")).toBe("existing");
	});

	it("points choices and includes at a skipped file's destination, not the package path", async () => {
		// Second import into a vault whose template folder is "My Templates":
		// the reader keeps every file that is already there.
		const { app, files } = fakeApp({
			"My Templates/MOC.md": "kept",
			"My Templates/Section.md": "kept",
			"My Templates/Dashboard.base": "kept",
		});

		const result = await applyPackageImport({
			app,
			existingChoices: [],
			pkg,
			choiceDecisions: [
				{ choiceId: "t1", mode: "import" },
				{ choiceId: "c1", mode: "import" },
			],
			assetDecisions: [
				{ originalPath: "Templates/MOC.md", destinationPath: "My Templates/MOC.md", mode: "skip" },
				{ originalPath: "Templates/Section.md", destinationPath: "My Templates/Section.md", mode: "write" },
				{ originalPath: "Templates/Dashboard.base", destinationPath: "My Templates/Dashboard.base", mode: "skip" },
			],
		});

		expect(result.skippedAssets).toEqual(["My Templates/MOC.md", "My Templates/Dashboard.base"]);
		expect(files.get("My Templates/MOC.md")).toBe("kept");
		expect(files.get("My Templates/Section.md")).toBe(
			"## {{VALUE}}\n{{TEMPLATE:My Templates/Dashboard.base}}\n",
		);
		const importedTemplate = result.updatedChoices[0] as ITemplateChoice;
		expect(importedTemplate.templatePath).toBe("My Templates/MOC.md");
		const importedCapture = result.updatedChoices[1] as ICaptureChoice;
		expect(importedCapture.format.format).toBe("{{TEMPLATE:My Templates/Section.md}}\n");
		expect(importedCapture.createFileIfItDoesntExist.template).toBe("My Templates/MOC.md");
	});

	it("writes anything that can run as code byte-for-byte, even when an include moved", async () => {
		const scriptBody = "```js\nmodule.exports = '{{TEMPLATE:Templates/Dashboard.base}}';\n```\n";
		const macro = macroChoice("m1", "Run", [userScript("s1", "Scripts/run.js")]);
		const codePkg = makePackage(
			[macro, template],
			[
				asset("user-script", "Scripts/run.js", "// {{TEMPLATE:Templates/Dashboard.base}}\n"),
				asset("template", "Templates/MOC.md", scriptBody),
				asset("template", "Templates/Dashboard.base", DASHBOARD_BASE),
			],
		);
		const { app, files } = fakeApp();

		await applyPackageImport({
			app,
			existingChoices: [],
			pkg: codePkg,
			choiceDecisions: [
				{ choiceId: "m1", mode: "import" },
				{ choiceId: "t1", mode: "import" },
			],
			assetDecisions: [
				{ originalPath: "Scripts/run.js", destinationPath: "Scripts/run.js", mode: "write" },
				{ originalPath: "Templates/MOC.md", destinationPath: "Templates/MOC.md", mode: "write" },
				{ originalPath: "Templates/Dashboard.base", destinationPath: "Elsewhere/Dashboard.base", mode: "write" },
			],
		});

		expect(files.get("Scripts/run.js")).toBe("// {{TEMPLATE:Templates/Dashboard.base}}\n");
		expect(files.get("Templates/MOC.md")).toBe(scriptBody);
	});

	it("rewrites includes inside .base and .canvas templates, which the formatter also renders", async () => {
		const base = "summary: {{TEMPLATE:Templates/Summary.md}}\n";
		const canvas = '{"nodes":[{"text":"{{TEMPLATE:Templates/Summary.md}}"}]}';
		const basePkg = makePackage(
			[templateChoice("t1", "Dashboard", "Templates/Dashboard.base")],
			[
				asset("template", "Templates/Dashboard.base", base),
				asset("template", "Boards/Board.canvas", canvas),
				asset("template", "Templates/Summary.md", "Summary\n"),
			],
		);
		const { app, files } = fakeApp();

		await applyPackageImport({
			app,
			existingChoices: [],
			pkg: basePkg,
			choiceDecisions: [{ choiceId: "t1", mode: "import" }],
			assetDecisions: [
				{ originalPath: "Templates/Dashboard.base", destinationPath: "Templates/Dashboard.base", mode: "write" },
				{ originalPath: "Boards/Board.canvas", destinationPath: "Boards/Board.canvas", mode: "write" },
				{ originalPath: "Templates/Summary.md", destinationPath: "My Templates/Summary.md", mode: "write" },
			],
		});

		expect(files.get("Templates/Dashboard.base")).toBe(
			"summary: {{TEMPLATE:My Templates/Summary.md}}\n",
		);
		expect(files.get("Boards/Board.canvas")).toBe(
			'{"nodes":[{"text":"{{TEMPLATE:My Templates/Summary.md}}"}]}',
		);
	});

	it("round-trips: an exported include chain imports into another folder and still resolves", async () => {
		const source = fakeApp({
			"Templates/MOC.md": MOC_TEMPLATE,
			"Templates/Dashboard.base": DASHBOARD_BASE,
		});
		const exported = await buildPackage(source.app, {
			choices: [template],
			rootChoiceIds: ["t1"],
			quickAddVersion: "2.30.0",
		});

		const target = fakeApp();
		const result = await applyPackageImport({
			app: target.app,
			existingChoices: [],
			pkg: exported.pkg,
			choiceDecisions: [{ choiceId: "t1", mode: "import" }],
			assetDecisions: exported.pkg.assets.map((a) => ({
				originalPath: a.originalPath,
				destinationPath: redirected(a.originalPath),
				mode: "write" as const,
			})),
		});

		const imported = result.updatedChoices[0] as ITemplateChoice;
		const content = target.files.get(imported.templatePath) ?? "";
		const includePath = /{{TEMPLATE:([^}]+)}}/.exec(content)?.[1];
		expect(includePath).toBe("My Templates/Dashboard.base");
		expect(target.files.get(includePath ?? "")).toBe(
			decodeFromBase64(exported.pkg.assets.find((a) => a.originalPath === "Templates/Dashboard.base")!.content),
		);
	});
});
