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
	isFullyReviewed,
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
		// A bundled script is critical even when nothing references it: it lands on
		// disk and any existing macro pointing at this path will run it.
		expect(requiresAcknowledgement(preview)).toBe(true);
		expect(preview.criticalScriptPaths).toContain("scripts/unused.js");
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
		expect(isFullyReviewed(preview, NONE)).toBe(false);
		expect(
			isFullyReviewed(preview, new Set(["scripts/orphan.js"])),
		).toBe(true);
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
	it("isFullyReviewed requires every critical script path to be reviewed", () => {
		const m = macro("m1", "Two scripts", [
			userScript("c1", "a", "scripts/a.js"),
			userScript("c2", "b", "scripts/b.js"),
		]);
		const pkg = makePackage(
			[pkgChoice(m, ["Two scripts"])],
			[asset("user-script", "scripts/a.js"), asset("user-script", "scripts/b.js")],
		);
		const preview = buildPackagePreview(NO_EXISTING, pkg, NONE);
		expect(isFullyReviewed(preview, new Set(["scripts/a.js"]))).toBe(false);
		expect(
			isFullyReviewed(preview, new Set(["scripts/a.js", "scripts/b.js"])),
		).toBe(true);
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
		expect(isFullyReviewed(preview, new Set())).toBe(true);
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
		expect(requiresAcknowledgement(preview)).toBe(false);
	});
});
