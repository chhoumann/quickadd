import { describe, expect, it } from "vitest";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { ICommand } from "../types/macros/ICommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type { ConditionalCondition } from "../types/macros/Conditional/types";
import { CommandType } from "../types/macros/CommandType";
import type {
	QuickAddPackage,
	QuickAddPackageAsset,
	QuickAddPackageAssetKind,
	QuickAddPackageChoice,
} from "../types/packages/QuickAddPackage";
import { encodeToBase64 } from "../utils/base64";
import {
	buildPackagePreview,
	collectReferencedAssetPaths,
	decodeAssetPreview,
	unreviewedScriptCount,
	requiresAcknowledgement,
	MAX_PREVIEW_CHARS,
} from "./packagePreview";

// --- Builders ---------------------------------------------------------------

function asset(
	kind: QuickAddPackageAssetKind,
	path: string,
	content = "// content",
): QuickAddPackageAsset {
	return {
		kind,
		originalPath: path,
		contentEncoding: "base64",
		content: encodeToBase64(content),
	};
}

function pkgChoice(
	choice: IChoice,
	pathHint: string[],
	parentChoiceId: string | null = null,
): QuickAddPackageChoice {
	return { choice, pathHint, parentChoiceId };
}

function makePackage(
	choices: QuickAddPackageChoice[],
	assets: QuickAddPackageAsset[] = [],
): QuickAddPackage {
	return {
		schemaVersion: 1,
		quickAddVersion: "1.18.0",
		createdAt: "2026-06-01T00:00:00.000Z",
		rootChoiceIds: choices
			.filter((entry) => entry.parentChoiceId === null)
			.map((entry) => entry.choice.id),
		choices,
		assets,
	};
}

function macro(
	id: string,
	name: string,
	commands: ICommand[],
	opts: { runOnStartup?: boolean; command?: boolean } = {},
): IMacroChoice {
	return {
		id,
		name,
		type: "Macro",
		command: opts.command ?? false,
		runOnStartup: opts.runOnStartup ?? false,
		macro: { id: `macro-${id}`, name, commands },
	};
}

function multi(
	id: string,
	name: string,
	choices: IChoice[],
	opts: { command?: boolean } = {},
): IMultiChoice {
	return {
		id,
		name,
		type: "Multi",
		command: opts.command ?? false,
		choices,
		collapsed: false,
	};
}

function userScript(id: string, name: string, path: string): IUserScript {
	return { id, name, type: CommandType.UserScript, path, settings: {} };
}

function conditional(
	id: string,
	name: string,
	condition: ConditionalCondition,
	thenCommands: ICommand[] = [],
	elseCommands: ICommand[] = [],
): IConditionalCommand {
	return {
		id,
		name,
		type: CommandType.Conditional,
		condition,
		thenCommands,
		elseCommands,
	};
}

function nested(id: string, name: string, choice: IChoice): INestedChoiceCommand {
	return { id, name, type: CommandType.NestedChoice, choice };
}

function obsidianCmd(id: string, name: string, commandId: string): IObsidianCommand {
	return { id, name, type: CommandType.Obsidian, commandId };
}

const NO_EXISTING: IChoice[] = [];
const NONE = new Set<string>();

// --- Tests ------------------------------------------------------------------

describe("buildPackagePreview - script detection & recursion", () => {
	it("detects a user script in a macro and marks the file executable + critical", () => {
		const m = macro("m1", "Daily Sync", [
			userScript("c1", "fetch", "scripts/fetch.js"),
		]);
		const pkg = makePackage(
			[pkgChoice(m, ["Daily Sync"])],
			[asset("user-script", "scripts/fetch.js")],
		);

		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);

		const file = preview.files.find((f) => f.originalPath === "scripts/fetch.js");
		expect(file?.executable).toBe(true);
		expect(preview.criticalScriptPaths).toContain("scripts/fetch.js");
		expect(preview.summary.hasCritical).toBe(true);
		expect(preview.summary.scriptCount).toBe(1);
		expect(
			preview.capabilityRows.some(
				(r) => r.flag === "user-script" && r.scriptPath === "scripts/fetch.js",
			),
		).toBe(true);
		const choice = preview.choices.find((c) => c.choiceId === "m1");
		expect(choice?.flags).toContain("user-script");
	});

	it("detects a user script inside a Conditional else-branch", () => {
		const cond = conditional(
			"c1",
			"branch",
			{ mode: "variable", variableName: "x", operator: "isTruthy", valueType: "boolean" },
			[],
			[userScript("c2", "cleanup", "scripts/cleanup.js")],
		);
		const m = macro("m1", "Brancher", [cond]);
		const pkg = makePackage(
			[pkgChoice(m, ["Brancher"])],
			[asset("user-script", "scripts/cleanup.js")],
		);

		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(preview.criticalScriptPaths).toContain("scripts/cleanup.js");
		const file = preview.files.find((f) => f.originalPath === "scripts/cleanup.js");
		expect(file?.executable).toBe(true);
	});

	it("detects a script-mode Conditional as critical", () => {
		const cond = conditional("c1", "check", {
			mode: "script",
			scriptPath: "scripts/cond.js",
		});
		const m = macro("m1", "Conditional Macro", [cond]);
		const pkg = makePackage(
			[pkgChoice(m, ["Conditional Macro"])],
			[asset("conditional-script", "scripts/cond.js")],
		);

		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(preview.criticalScriptPaths).toContain("scripts/cond.js");
		expect(
			preview.capabilityRows.some((r) => r.flag === "conditional-script"),
		).toBe(true);
	});

	it("detects a user script inside a NestedChoice-embedded macro (attributed to parent)", () => {
		const innerMacro = macro("inner", "Inner", [
			userScript("c2", "deep", "scripts/deep.js"),
		]);
		const outer = macro("m1", "Outer", [nested("n1", "Run inner", innerMacro)]);
		const pkg = makePackage(
			[pkgChoice(outer, ["Outer"])],
			[asset("user-script", "scripts/deep.js")],
		);

		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		// The embedded macro is not its own pkg.choices entry.
		expect(preview.choices).toHaveLength(1);
		expect(preview.criticalScriptPaths).toContain("scripts/deep.js");
		const choice = preview.choices.find((c) => c.choiceId === "m1");
		expect(choice?.flags).toContain("user-script");
	});

	it("detects runOnStartup at top level and inside a nested macro", () => {
		const startupTop = macro("m1", "Startup", [], { runOnStartup: true });
		const nestedStartup = macro("inner", "NestedStartup", [], {
			runOnStartup: true,
		});
		const host = macro("m2", "Host", [nested("n1", "Run", nestedStartup)]);
		const pkg = makePackage([
			pkgChoice(startupTop, ["Startup"]),
			pkgChoice(host, ["Host"]),
		]);

		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(preview.summary.runsOnStartup).toBe(true);
		expect(preview.choices.find((c) => c.choiceId === "m1")?.flags).toContain(
			"run-on-startup",
		);
		expect(preview.choices.find((c) => c.choiceId === "m2")?.flags).toContain(
			"run-on-startup",
		);
		const startupRows = preview.capabilityRows.filter(
			(r) => r.flag === "run-on-startup",
		);
		expect(startupRows).toHaveLength(2);
	});
});

describe("buildPackagePreview - choice flags & dedupe", () => {
	it("flags command:true on a Multi child without double-counting it", () => {
		const child = macro("child", "Child", [], { command: true });
		const parent = multi("parent", "Folder", [child]);
		// Both parent and child are their own pkg.choices entries (as export emits).
		const pkg = makePackage([
			pkgChoice(parent, ["Folder"]),
			pkgChoice(child, ["Folder", "Child"], "parent"),
		]);

		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(preview.choices).toHaveLength(2);
		const childPreview = preview.choices.find((c) => c.choiceId === "child");
		expect(childPreview?.registersCommand).toBe(true);
		expect(childPreview?.flags).toContain("registers-command");
		// The parent Multi entry must NOT re-collect the child's capability.
		const parentPreview = preview.choices.find((c) => c.choiceId === "parent");
		expect(parentPreview?.flags).not.toContain("registers-command");
		expect(preview.summary.registersCommandCount).toBe(1);
	});

	it("attributes an inline-only Multi child's capabilities to its parent (no hiding)", () => {
		// A crafted package puts a dangerous macro inline in a Multi.choices array
		// WITHOUT listing it as its own pkg.choices entry.
		const hidden = macro(
			"hidden",
			"Hidden",
			[userScript("c1", "run", "scripts/hidden.js")],
			{ runOnStartup: true },
		);
		const folder = multi("folder", "Folder", [hidden]);
		const pkg = makePackage(
			[pkgChoice(folder, ["Folder"])],
			[asset("user-script", "scripts/hidden.js")],
		);

		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		// Only the folder has a row; the inline child must not be silently dropped.
		expect(preview.choices).toHaveLength(1);
		const folderChoice = preview.choices.find((c) => c.choiceId === "folder");
		expect(folderChoice?.flags).toContain("run-on-startup");
		expect(folderChoice?.flags).toContain("user-script");
		expect(preview.criticalScriptPaths).toContain("scripts/hidden.js");
	});

	it("does not double-count a Multi child that is also its own entry", () => {
		const child = macro("child", "Child", [
			userScript("c1", "run", "scripts/child.js"),
		]);
		const parent = multi("parent", "Folder", [child]);
		const pkg = makePackage(
			[
				pkgChoice(parent, ["Folder"]),
				pkgChoice(child, ["Folder", "Child"], "parent"),
			],
			[asset("user-script", "scripts/child.js")],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		// The script is attributed to the child row only, not also to the parent.
		const parentChoice = preview.choices.find((c) => c.choiceId === "parent");
		expect(parentChoice?.flags).not.toContain("user-script");
		const userScriptRows = preview.capabilityRows.filter(
			(r) => r.flag === "user-script",
		);
		expect(userScriptRows).toHaveLength(1);
	});

	it("flags AI commands as warning (not critical)", () => {
		const m = macro("m1", "AI", [
			{ id: "c1", name: "Assist", type: CommandType.AIAssistant } as ICommand,
		]);
		const pkg = makePackage([pkgChoice(m, ["AI"])]);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		const aiRow = preview.capabilityRows.find((r) => r.flag === "ai");
		expect(aiRow?.severity).toBe("warning");
		expect(preview.summary.hasCritical).toBe(false);
	});

	it("surfaces the literal Obsidian commandId", () => {
		const m = macro("m1", "Runner", [
			obsidianCmd("c1", "Toggle", "app:toggle-left-sidebar"),
		]);
		const pkg = makePackage([pkgChoice(m, ["Runner"])]);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		const row = preview.capabilityRows.find((r) => r.flag === "obsidian-command");
		expect(row?.detail).toContain("app:toggle-left-sidebar");
	});

	it("names a script's path once, even when the step is named after it (#1880)", () => {
		const path = "Scripts/Books/fetch.js";
		const m = macro("m1", "Fetch media", [
			userScript("c1", path, path),
			userScript("c2", `${path}::run`, path),
			userScript("c3", "fetch", path),
			conditional("c4", path, { mode: "script", scriptPath: path }),
		]);
		const preview = buildPackagePreview(NO_EXISTING, makePackage([pkgChoice(m, ["Fetch media"])]), NONE);
		expect(
			preview.capabilityRows
				.filter((r) => r.flag === "user-script" || r.flag === "conditional-script")
				.map((r) => r.detail),
		).toEqual([
			`Fetch media › ${path}`,
			`Fetch media › ${path}::run`,
			`Fetch media › fetch (${path})`,
			`Fetch media › ${path}`,
		]);
	});

	it("stops promising AI for a legacy InfiniteAIAssistant command", () => {
		// It used to share the AIAssistant row, so the disclosure said "Sends note
		// content to your AI provider" for a step the engine could not run at all.
		// With the type removed it falls to the unknown-command row - a warning to
		// review it by hand, which beats a promise the step cannot keep. (The
		// engine still names the retired type by name when the macro runs; the
		// preview deliberately derives its vocabulary from the live enum.)
		const m = macro("m1", "Legacy", [
			{
				id: "c1",
				name: "Summarise",
				type: "InfiniteAIAssistant" as CommandType,
			} as ICommand,
		]);
		const pkg = makePackage([pkgChoice(m, ["Legacy"])]);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);

		expect(preview.capabilityRows.some((r) => r.flag === "ai")).toBe(false);
		expect(
			preview.capabilityRows.some((r) => r.flag === "unknown-command"),
		).toBe(true);
		// The disclosure renders a capability tag for a flagged command, never the
		// raw type string that no longer has a human label.
		expect(
			preview.choices
				.flatMap((choice) => choice.commands)
				.find((c) => c.name === "Summarise")?.flag,
		).toBe("unknown-command");
	});

	it("flags an unknown CommandType instead of dropping it", () => {
		const m = macro("m1", "Future", [
			{ id: "c1", name: "Mystery", type: "FutureThing" as CommandType } as ICommand,
		]);
		const pkg = makePackage([pkgChoice(m, ["Future"])]);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(
			preview.capabilityRows.some((r) => r.flag === "unknown-command"),
		).toBe(true);
	});
});

describe("buildPackagePreview - safety must-fixes", () => {
	it("treats a script mislabeled as a template as executable + critical (command graph wins)", () => {
		const m = macro("m1", "Sneaky", [
			userScript("c1", "run", "scripts/looks-like-template.md"),
		]);
		// Bundled as kind 'template' but referenced as a script.
		const pkg = makePackage(
			[pkgChoice(m, ["Sneaky"])],
			[asset("template", "scripts/looks-like-template.md")],
		);

		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		const file = preview.files.find(
			(f) => f.originalPath === "scripts/looks-like-template.md",
		);
		expect(file?.executable).toBe(true);
		expect(
			preview.capabilityRows.some((r) => r.flag === "mislabeled-executable"),
		).toBe(true);
		expect(preview.criticalScriptPaths).toContain(
			"scripts/looks-like-template.md",
		);
	});

	it("reports a referenced-but-unbundled script as a missing reference, not a file", () => {
		const m = macro("m1", "Needs script", [
			userScript("c1", "run", "scripts/absent.js"),
		]);
		const pkg = makePackage([pkgChoice(m, ["Needs script"])], []);

		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(preview.files).toHaveLength(0);
		expect(preview.missingReferences).toHaveLength(1);
		expect(preview.missingReferences[0]).toMatchObject({
			path: "scripts/absent.js",
			asScript: true,
		});
		expect(preview.summary.missingCount).toBe(1);
	});

	it("does not report a referenced unbundled path as missing when it exists in the vault", () => {
		const m = macro("m1", "Uses local", [
			userScript("c1", "run", "scripts/local.js"),
		]);
		const pkg = makePackage([pkgChoice(m, ["Uses local"])], []);
		const preview = buildPackagePreview(
			NO_EXISTING,
			pkg,
			new Set(["scripts/local.js"]),
		);
		expect(preview.missingReferences).toHaveLength(0);
	});

	it("keeps a brand-new user script critical and acknowledgement-required (nothing overwritten)", () => {
		const m = macro("m1", "New", [userScript("c1", "run", "scripts/new.js")]);
		const pkg = makePackage(
			[pkgChoice(m, ["New"])],
			[asset("user-script", "scripts/new.js")],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(preview.summary.overwritesChoices).toBe(0);
		expect(preview.summary.overwritesFiles).toBe(0);
		expect(requiresAcknowledgement(preview)).toBe(true);
	});

	it("discloses a bundled script that gives an AI model vault tools (#714)", () => {
		const m = macro("m1", "Librarian", [
			userScript("c1", "run", "scripts/agent.js"),
		]);
		const pkg = makePackage(
			[pkgChoice(m, ["Librarian"])],
			[
				asset(
					"user-script",
					"scripts/agent.js",
					"module.exports = async ({ quickAddApi }) => {\n" +
						"  const a = quickAddApi.ai.agent({ model: 'gpt-4o', tools: { ...quickAddApi.ai.tools.vault() } });\n" +
						"  return (await a.generate({ prompt: 'hi' })).text;\n" +
						"};",
				),
			],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		const row = preview.capabilityRows.find((r) => r.flag === "ai-tools");
		expect(row).toBeDefined();
		expect(row?.severity).toBe("critical");
		expect(row?.scriptPath).toBe("scripts/agent.js");
	});

	it("discloses AI tools hidden in an orphan note's js fence, not a plain script", () => {
		// Orphan .md (referenced by no choice) with a js fence using destructured ai.tools.
		const fenced =
			"Some notes about the agent.\n\n```js\n" +
			"const { ai } = quickAddApi;\n" +
			"const tools = ai.tools.workspace();\n" +
			"```\n";
		const pkg = makePackage(
			[pkgChoice(macro("m1", "Plain", [userScript("c1", "run", "scripts/plain.js")]), ["Plain"])],
			[
				asset("template", "Notes/hidden-agent.md", fenced),
				asset("user-script", "scripts/plain.js", "module.exports = () => 1;"),
			],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		const aiToolRows = preview.capabilityRows.filter((r) => r.flag === "ai-tools");
		expect(aiToolRows.map((r) => r.scriptPath)).toEqual(["Notes/hidden-agent.md"]);
		// A plain script that never touches AI tools gets no ai-tools row.
		expect(aiToolRows.some((r) => r.scriptPath === "scripts/plain.js")).toBe(false);
	});
});

describe("buildPackagePreview - files manifest, overwrites, orphans, captures", () => {
	it("marks files added vs overwritten from existsByPath", () => {
		const tmpl = {
			id: "t1",
			name: "Note",
			type: "Template",
			command: false,
			templatePath: "templates/Note.md",
			fileExistsBehavior: { kind: "apply", mode: "overwrite" },
		} as unknown as ITemplateChoice;
		const pkg = makePackage(
			[pkgChoice(tmpl, ["Note"])],
			[
				asset("template", "templates/Note.md"),
				asset("user-script", "scripts/new.js"),
			],
		);
		const preview = buildPackagePreview(
			NO_EXISTING,
			pkg,
			new Set(["templates/Note.md"]),
		);
		const note = preview.files.find((f) => f.originalPath === "templates/Note.md");
		expect(note?.exists).toBe(true);
		expect(preview.summary.overwritesFiles).toBe(1);
		expect(preview.choices.find((c) => c.choiceId === "t1")?.flags).toContain(
			"template-write",
		);
	});

	it("detects an orphan bundled asset", () => {
		const m = macro("m1", "Empty", []);
		const pkg = makePackage(
			[pkgChoice(m, ["Empty"])],
			[asset("user-script", "scripts/unused.js")],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(preview.orphanAssets).toContain("scripts/unused.js");
		const file = preview.files.find((f) => f.originalPath === "scripts/unused.js");
		expect(file?.orphan).toBe(true);
		// Unreferenced => not classified executable.
		expect(file?.executable).toBe(false);
		expect(file?.requiresReview).toBe(true);
		// A bundled script is critical even when nothing references it: it lands on
		// disk and any existing macro pointing at this path will run it.
		expect(requiresAcknowledgement(preview)).toBe(true);
		expect(preview.criticalScriptPaths).toContain("scripts/unused.js");
	});

	// Import refuses these destinations, so the preview must show the break.
	it.each([
		["an absolute path", "/templates/Note.md", "templates/Note.md"],
		["a config directory", ".obsidian/templates/Note.md", ".obsidian/templates/Note.md"],
	])("does not let an asset at %s satisfy a reference", (_, assetPath, templatePath) => {
		const tmpl = {
			id: "t1",
			name: "Note",
			type: "Template",
			command: false,
			templatePath,
		} as unknown as ITemplateChoice;
		const pkg = makePackage([pkgChoice(tmpl, ["Note"])], [asset("template", assetPath)]);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(preview.missingReferences.map((r) => r.path)).toEqual([templatePath]);
		expect(preview.orphanAssets).toEqual([assetPath]);
	});

	it("treats an orphan bundled script as critical and review-required", () => {
		const m = macro("m1", "Empty", []);
		const pkg = makePackage(
			[pkgChoice(m, ["Empty"])],
			[asset("user-script", "scripts/orphan.js")],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(requiresAcknowledgement(preview)).toBe(true);
		expect(preview.summary.hasCritical).toBe(true);
		expect(preview.criticalScriptPaths).toContain("scripts/orphan.js");
		// Gate is real: not reviewed yet => not fully reviewed.
		expect(unreviewedScriptCount(preview, NONE, NONE)).toBe(1);
		expect(
			unreviewedScriptCount(preview, new Set(["scripts/orphan.js"]), NONE),
		).toBe(0);
	});

	it("flags an orphan .md note-script that lies about its kind (#1065)", () => {
		// A bundled note labeled "template" and referenced by no choice would slip
		// the disclosure gate, land on disk, and run via any macro pointing at its
		// path. Since a note's ```js fence is now executable, the gate must catch it.
		const m = macro("m1", "Empty", []);
		const note = asset(
			"template",
			"Notes/payload.md",
			"# Looks harmless\n\n```js\nmodule.exports = () => exfiltrate();\n```\n",
		);
		const pkg = makePackage([pkgChoice(m, ["Empty"])], [note]);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);

		const file = preview.files.find(
			(f) => f.originalPath === "Notes/payload.md",
		);
		expect(file?.orphan).toBe(true);
		expect(file?.requiresReview).toBe(true);
		expect(requiresAcknowledgement(preview)).toBe(true);
		expect(preview.criticalScriptPaths).toContain("Notes/payload.md");
		expect(unreviewedScriptCount(preview, NONE, NONE)).toBe(1);
	});

	it("does not gate bundled files that hold no code QuickAdd runs (#1881)", () => {
		// The user-script loader only runs .js files and notes, so a Base, a canvas,
		// or a file with any other extension cannot run, whatever `kind` it claims.
		const m = macro("m1", "Empty", []);
		const payload = "module.exports = () => exfiltrate();";
		const pkg = makePackage(
			[pkgChoice(m, ["Empty"])],
			[
				asset("template", "Templates/Dashboard.base", "views:\n  - type: table\n"),
				asset("template", "Boards/Plan.canvas", '{"nodes":[],"edges":[]}'),
				asset("user-script", "scripts/payload.txt", payload),
				asset("template", "scripts/payload", payload),
			],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);

		expect(preview.files.map((file) => file.requiresReview)).toEqual([
			false, false, false, false,
		]);
		expect(preview.criticalScriptPaths).toEqual([]);
		expect(requiresAcknowledgement(preview)).toBe(false);
	});

	it("gates every bundled file that holds code QuickAdd runs", () => {
		const m = macro("m1", "Empty", []);
		const inline = "```js quickadd\nreturn app.vault.getName();\n```";
		const pkg = makePackage(
			[pkgChoice(m, ["Empty"])],
			[
				asset("template", "scripts/Upper.JS", "module.exports = () => {};"),
				// A reviewed script can require() a module it ships alongside.
				asset("template", "scripts/lib.cjs", "module.exports = {};"),
				asset("template", "scripts/lib.mjs", "export default {};"),
				// The formatter runs a `js quickadd` fence anywhere in a template.
				asset("template", "Templates/Dashboard.base", `filters: "${inline}"`),
				asset("template", "Boards/Plan.canvas", `{"nodes":[{"text":"${inline}"}]}`),
				asset("template", "Templates/inline.md", `Name: \`\`\`js quickadd return 1\`\`\``),
			],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);

		expect(preview.criticalScriptPaths).toEqual([
			"scripts/Upper.JS",
			"scripts/lib.cjs",
			"scripts/lib.mjs",
			"Templates/Dashboard.base",
			"Boards/Plan.canvas",
			"Templates/inline.md",
		]);
		expect(requiresAcknowledgement(preview)).toBe(true);
	});

	it("scans a backtick flood in a bundled template in linear time", () => {
		const m = macro("m1", "Empty", []);
		const flood = "`".repeat(200_000);
		const pkg = makePackage(
			[pkgChoice(m, ["Empty"])],
			[
				asset("template", "Templates/flood.base", `name: ${flood}`),
				asset("template", "Templates/flood.canvas", `${flood}js quickadd return 1;`),
			],
		);
		const started = performance.now();
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(performance.now() - started).toBeLessThan(1000);
		expect(preview.criticalScriptPaths).toEqual([]);
	});

	it("scans a template's inline fences for AI tool use", () => {
		const m = macro("m1", "Empty", []);
		const pkg = makePackage(
			[pkgChoice(m, ["Empty"])],
			[
				asset(
					"template",
					"Templates/agent.base",
					"note: |\n  ```js quickadd\n  await quickAddApi.ai.agent({});\n  ```\n",
				),
			],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);

		expect(preview.capabilityRows.map((row) => row.flag)).toContain("ai-tools");
	});

	it("does not flag a plain .md template with no js code block", () => {
		const m = macro("m1", "Empty", []);
		const note = asset(
			"template",
			"Templates/daily.md",
			"# Daily\n\n- [ ] task\n\n```python\nprint('not js')\n```\n",
		);
		const pkg = makePackage([pkgChoice(m, ["Empty"])], [note]);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);

		const file = preview.files.find(
			(f) => f.originalPath === "Templates/daily.md",
		);
		expect(file?.requiresReview).toBe(false);
		expect(preview.criticalScriptPaths).not.toContain("Templates/daily.md");
	});

	it("treats a bundled script that overwrites an existing file as critical", () => {
		const m = macro("m1", "Empty", []);
		const pkg = makePackage(
			[pkgChoice(m, ["Empty"])],
			[asset("user-script", "scripts/existing.js")],
		);
		const preview = buildPackagePreview(
			NO_EXISTING,
			pkg,
			new Set(["scripts/existing.js"]),
		);
		expect(requiresAcknowledgement(preview)).toBe(true);
		expect(preview.criticalScriptPaths).toContain("scripts/existing.js");
		expect(preview.summary.overwritesFiles).toBe(1);
	});

	it("requires acknowledgement when the only effect is dropping a non-referenced script", () => {
		const m = macro("m1", "Empty", []);
		const pkg = makePackage(
			[pkgChoice(m, ["Empty"])],
			[asset("conditional-script", "scripts/cond-orphan.js")],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(requiresAcknowledgement(preview)).toBe(true);
		expect(preview.criticalScriptPaths).toContain("scripts/cond-orphan.js");
	});

	it("treats a .js asset declared as a non-script kind as critical (untrusted kind)", () => {
		const m = macro("m1", "Empty", []);
		const pkg = makePackage(
			[pkgChoice(m, ["Empty"])],
			[asset("template", "scripts/evil.js")],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(requiresAcknowledgement(preview)).toBe(true);
		expect(preview.criticalScriptPaths).toContain("scripts/evil.js");
		expect(
			preview.files.find((file) => file.originalPath === "scripts/evil.js")
				?.requiresReview,
		).toBe(true);
	});

	it("keeps critical script paths aligned with files that require review", () => {
		const m = macro("m1", "Empty", []);
		const pkg = makePackage(
			[pkgChoice(m, ["Empty"])],
			[
				asset("user-script", "scripts/orphan.js"),
				asset("template", "scripts/mislabeled.js"),
				asset("template", "templates/note.md"),
			],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		const pathsRequiringReview = preview.files
			.filter((file) => file.requiresReview)
			.map((file) => file.originalPath);
		expect(new Set(preview.criticalScriptPaths)).toEqual(
			new Set(pathsRequiringReview),
		);
		expect(preview.criticalScriptPaths).toEqual([
			"scripts/orphan.js",
			"scripts/mislabeled.js",
		]);
	});

	it("gates the capture-template by the triple-boolean", () => {
		const base = {
			id: "cap1",
			name: "Cap",
			type: "Capture",
			command: false,
			captureTo: "Inbox.md",
			captureToActiveFile: false,
		};
		const withoutTemplate = {
			...base,
			createFileIfItDoesntExist: {
				enabled: true,
				createWithTemplate: false,
				template: "templates/Cap.md",
			},
		} as unknown as ICaptureChoice;
		const pkg = makePackage([pkgChoice(withoutTemplate, ["Cap"])], []);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		// createWithTemplate=false => the template is NOT referenced.
		expect(preview.missingReferences).toHaveLength(0);
		expect(preview.choices.find((c) => c.choiceId === "cap1")?.flags).toContain(
			"capture-writes",
		);
	});

	it("flags an existing choice id as an overwrite", () => {
		const m = macro("m1", "Existing", []);
		const pkg = makePackage([pkgChoice(m, ["Existing"])]);
		const existing: IChoice[] = [
			{ id: "m1", name: "Existing", type: "Macro", command: false } as IChoice,
		];
		const preview = buildPackagePreview(existing, pkg, NONE);
		expect(preview.choices.find((c) => c.choiceId === "m1")?.exists).toBe(true);
		expect(preview.summary.overwritesChoices).toBe(1);
	});
});

describe("collectReferencedAssetPaths", () => {
	it("collects every referenced script/template path once", () => {
		const m = macro("m1", "Multi-ref", [
			userScript("c1", "a", "scripts/a.js"),
			userScript("c2", "b", "scripts/a.js"),
			conditional("c3", "c", { mode: "script", scriptPath: "scripts/cond.js" }),
		]);
		const pkg = makePackage([pkgChoice(m, ["Multi-ref"])]);
		const paths = collectReferencedAssetPaths(pkg).sort();
		expect(paths).toEqual(["scripts/a.js", "scripts/cond.js"]);
	});
});

describe("decodeAssetPreview", () => {
	it("round-trips bundled base64 content", () => {
		const source = "const x = 1;\nexport default x;";
		const pkg = makePackage([], [asset("user-script", "s.js", source)]);
		const result = decodeAssetPreview(pkg, "s.js");
		expect(result.found).toBe(true);
		expect(result.text).toBe(source);
		expect(result.truncated).toBe(false);
	});

	it("flags truncation past the cap", () => {
		const source = "a".repeat(MAX_PREVIEW_CHARS + 50);
		const pkg = makePackage([], [asset("user-script", "big.js", source)]);
		const result = decodeAssetPreview(pkg, "big.js");
		expect(result.truncated).toBe(true);
		expect(result.text.length).toBe(MAX_PREVIEW_CHARS);
	});

	it("detects a minified single-line script", () => {
		const source = `const f=()=>{${"x".repeat(2000)}};`;
		const pkg = makePackage([], [asset("user-script", "min.js", source)]);
		const result = decodeAssetPreview(pkg, "min.js");
		expect(result.looksMinified).toBe(true);
	});

	it("returns not-found for an unbundled path", () => {
		const pkg = makePackage([], []);
		const result = decodeAssetPreview(pkg, "missing.js");
		expect(result.found).toBe(false);
		expect(result.error).toBeTruthy();
	});
});

describe("gate predicates", () => {
	it("unreviewedScriptCount counts every critical script path not yet reviewed", () => {
		const m = macro("m1", "Two scripts", [
			userScript("c1", "a", "scripts/a.js"),
			userScript("c2", "b", "scripts/b.js"),
		]);
		const pkg = makePackage(
			[pkgChoice(m, ["Two scripts"])],
			[asset("user-script", "scripts/a.js"), asset("user-script", "scripts/b.js")],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(unreviewedScriptCount(preview, new Set(["scripts/a.js"]), NONE)).toBe(1);
		expect(
			unreviewedScriptCount(preview, new Set(["scripts/a.js", "scripts/b.js"]), NONE),
		).toBe(0);
	});

	it("requires acknowledgement but has no script gate set for a startup-only macro", () => {
		// runOnStartup is critical on its own, but there is no bundled script to
		// review — the gate set must be empty so the flow stays honest (the banner
		// copy, not a vacuous 'reviewed each script' claim, carries the weight).
		const m = macro("m1", "Startup", [], { runOnStartup: true });
		const pkg = makePackage([pkgChoice(m, ["Startup"])]);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(requiresAcknowledgement(preview)).toBe(true);
		expect(preview.criticalScriptPaths).toEqual([]);
		// Nothing to expand -> trivially reviewed; acknowledgement still required.
		expect(unreviewedScriptCount(preview, NONE, NONE)).toBe(0);
	});

	it("requiresAcknowledgement is false for a package with no critical capability", () => {
		const tmpl = {
			id: "t1",
			name: "Note",
			type: "Template",
			command: false,
			templatePath: "templates/Note.md",
			fileExistsBehavior: { kind: "prompt" },
		} as unknown as ITemplateChoice;
		const pkg = makePackage(
			[pkgChoice(tmpl, ["Note"])],
			[asset("template", "templates/Note.md")],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(preview.files[0]?.requiresReview).toBe(false);
		expect(requiresAcknowledgement(preview)).toBe(false);
	});
});

describe("buildPackagePreview - inline JavaScript in a choice's own settings", () => {
	const inline = "```js quickadd\nreturn app.vault.getName();\n```";
	const scriptRows = (preview: ReturnType<typeof buildPackagePreview>) =>
		preview.capabilityRows
			.filter((row) => row.flag === "user-script")
			.map((row) => [row.severity, row.title, row.detail]);
	const ROW = "Runs custom JavaScript written into a choice setting";

	it("gates each formatted Capture and Template setting that holds a js quickadd fence", () => {
		const capture = {
			id: "c1",
			name: "Log",
			type: "Capture",
			command: false,
			captureTo: `Logs/${inline}.md`,
			captureToActiveFile: false,
			format: { enabled: true, format: `- ${inline}` },
			insertAfter: { enabled: true, after: `## ${inline}` },
			insertBefore: { enabled: false, before: inline },
			propertyCapture: { property: { kind: "named", format: inline }, action: "set", createIfMissing: true },
		} as unknown as ICaptureChoice;
		const template = {
			id: "t1",
			name: "Note",
			type: "Template",
			command: false,
			templatePath: "templates/Note.md",
			fileNameFormat: { enabled: true, format: `Note ${inline}` },
			folder: { enabled: true, folders: ["Plain", `Dated/${inline}`, `Again/${inline}`] },
		} as unknown as ITemplateChoice;
		const preview = buildPackagePreview(
			NO_EXISTING,
			makePackage([pkgChoice(capture, ["Log"]), pkgChoice(template, ["Note"])]),
			NONE,
		);

		expect(scriptRows(preview)).toEqual([
			["critical", ROW, "Log › capture to"],
			["critical", ROW, "Log › capture format"],
			["critical", ROW, "Log › insert after"],
			["critical", ROW, "Log › insert before"],
			["critical", ROW, "Log › property name"],
			["critical", ROW, "Note › file name format"],
			["critical", ROW, "Note › folder"],
		]);
		expect(preview.choices.map((choice) => choice.flags)).toEqual([
			expect.arrayContaining(["user-script"]),
			expect.arrayContaining(["user-script"]),
		]);
		expect(requiresAcknowledgement(preview)).toBe(true);
		// The code lives in the choice, not in a bundled file. Each value is shown
		// whole, including every folder that shares the one "folder" row.
		expect(preview.criticalScriptPaths).toEqual([]);
		expect(preview.choices.map((choice) => choice.inlineScripts)).toEqual([
			[
				{ setting: "capture to", text: `Logs/${inline}.md` },
				{ setting: "capture format", text: `- ${inline}` },
				{ setting: "insert after", text: `## ${inline}` },
				{ setting: "insert before", text: inline },
				{ setting: "property name", text: inline },
			],
			[
				{ setting: "file name format", text: `Note ${inline}` },
				{ setting: "folder", text: `Dated/${inline}` },
				{ setting: "folder", text: `Again/${inline}` },
			],
		]);
		// Viewing counts per choice, like opening a bundled file.
		expect(unreviewedScriptCount(preview, NONE, NONE)).toBe(2);
		expect(unreviewedScriptCount(preview, NONE, new Set(["c1"]))).toBe(1);
		expect(unreviewedScriptCount(preview, NONE, new Set(["c1", "t1"]))).toBe(0);
		// A file path is not a choice id, even when a crafted package makes them equal.
		expect(unreviewedScriptCount(preview, new Set(["c1", "t1"]), NONE)).toBe(2);
	});

	it("finds it in an inline Multi child and in a macro's Open file path", () => {
		const child = {
			id: "c2",
			name: "Hidden",
			type: "Capture",
			command: false,
			captureTo: "Inbox.md",
			format: { enabled: true, format: inline },
		} as unknown as ICaptureChoice;
		const openFile = {
			id: "o1",
			name: "Open log",
			type: CommandType.OpenFile,
			filePath: `Logs/${inline}.md`,
		} as unknown as ICommand;
		const preview = buildPackagePreview(
			NO_EXISTING,
			makePackage([
				pkgChoice(multi("f1", "Folder", [child]), ["Folder"]),
				pkgChoice(macro("m1", "Macro", [openFile]), ["Macro"]),
			]),
			NONE,
		);

		expect(scriptRows(preview).map(([, , detail]) => detail)).toEqual([
			"Folder › Hidden › capture format",
			"Macro › Open log › file path",
		]);
		expect(preview.choices[1]?.commands[0]?.flag).toBe("user-script");
		// Shown under the top-level choice, named from there.
		expect(preview.choices.map((choice) => choice.inlineScripts)).toEqual([
			[{ setting: "Hidden › capture format", text: inline }],
			[{ setting: "Open log › file path", text: `Logs/${inline}.md` }],
		]);
	});

	it("leaves settings without a runnable fence unflagged", () => {
		const capture = {
			id: "c1",
			name: "Plain",
			type: "Capture",
			command: false,
			captureTo: "Journal/{{DATE:YYYY-MM-DD}}.md",
			format: {
				enabled: true,
				// Tokens, Templater, a plain js code block, and an empty fence
				// (which the formatter consumes without running anything).
				format: "- {{DATE:HH:mm}} {{VALUE}} <% tp.date.now() %>\n```js\nconsole.log(1)\n```\n```js quickadd\n```",
			},
			insertAfter: { enabled: true, after: "## {{DATE}}" },
		} as unknown as ICaptureChoice;
		const template = {
			id: "t1",
			name: "Note",
			type: "Template",
			command: false,
			// Not formatted with format(): scalar tokens only, so no code runs here.
			templatePath: `templates/${inline}.md`,
			fileNameFormat: { enabled: true, format: "{{VALUE:title}}" },
			folder: { enabled: true, folders: ["Notes/{{DATE:YYYY}}"] },
		} as unknown as ITemplateChoice;
		const preview = buildPackagePreview(
			NO_EXISTING,
			makePackage([pkgChoice(capture, ["Plain"]), pkgChoice(template, ["Note"])]),
			NONE,
		);

		expect(scriptRows(preview)).toEqual([]);
		expect(preview.summary.hasCritical).toBe(false);
		expect(preview.choices.flatMap((choice) => choice.inlineScripts)).toEqual([]);
	});
});
