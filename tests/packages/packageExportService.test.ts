import { describe, expect, it, vi, beforeEach } from "vitest";
import type { App } from "obsidian";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { UserScript } from "../../src/types/macros/UserScript";
import { ChoiceCommand } from "../../src/types/macros/ChoiceCommand";
import {
	QUICKADD_PACKAGE_SCHEMA_VERSION,
} from "../../src/types/packages/QuickAddPackage";
import {
	buildPackage,
	generateDefaultPackagePath,
	writePackageToVault,
} from "../../src/services/packageExportService";
import { parseQuickAddPackage } from "../../src/services/packageImportService";
import { encodeToBase64 } from "../../src/utils/base64";

function createMockApp(options?: {
	existingPaths?: Record<string, string>;
}): App {
	const existing = new Map<string, string>(
		Object.entries(options?.existingPaths ?? {}),
	);

	const adapterExists = vi.fn(async (path: string) => existing.has(path));
	const adapterRead = vi.fn(async (path: string) => {
		const content = existing.get(path);
		if (content === undefined) {
			throw new Error(`Missing: ${path}`);
		}
		return content;
	});
	const adapterWrite = vi.fn(async (_path: string, _content: string) => {
		/* noop for test */
	});

	const createFolder = vi.fn(async (folder: string) => {
		existing.set(folder, "");
	});

	return {
		vault: {
			adapter: {
				exists: adapterExists,
				read: adapterRead,
				write: adapterWrite,
			},
			createFolder,
		},
	} as unknown as App;
}

describe("packageExportService", () => {
	const QUICKADD_VERSION = "2.5.0";

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("buildPackage embeds user scripts and preserves choice order", async () => {
		const macro = new MacroChoice("My Macro");
		const scriptPath = "Scripts/doThing.js";
		macro.macro.commands.push(new UserScript("Run script", scriptPath));

		const app = createMockApp({
			existingPaths: {
				[scriptPath]: "console.log('hello world');",
			},
		});

		const result = await buildPackage(app, {
			choices: [macro],
			rootChoiceIds: [macro.id],
			quickAddVersion: QUICKADD_VERSION,
		});

		expect(result.missingChoiceIds).toHaveLength(0);
		expect(result.missingAssets).toHaveLength(0);
		expect(result.pkg.choices).toHaveLength(1);
		expect(result.pkg.choices[0].choice.name).toBe("My Macro");
		expect(result.pkg.assets).toHaveLength(1);
		expect(result.pkg.assets[0].originalPath).toBe(scriptPath);

		const serialized = JSON.stringify(result.pkg, null, 2);
		const parsed = parseQuickAddPackage(serialized);
		expect(parsed.choices).toHaveLength(1);

	const expectedContent = encodeToBase64("console.log('hello world');");
		expect(result.pkg.assets[0].content).toBe(expectedContent);
	});

	it("buildPackage records missing scripts", async () => {
		const macro = new MacroChoice("Missing script macro");
		const scriptPath = "Scripts/missing.js";
		macro.macro.commands.push(new UserScript("Run missing", scriptPath));

		const app = createMockApp();

		const result = await buildPackage(app, {
			choices: [macro],
			rootChoiceIds: [macro.id],
			quickAddVersion: QUICKADD_VERSION,
		});

		expect(result.pkg.assets).toHaveLength(0);
		expect(result.missingAssets).toContainEqual({
			path: scriptPath,
			kind: "user-script",
		});
	});

	it("buildPackage embeds template assets", async () => {
		const templateChoice = new TemplateChoice("Daily Note");
		templateChoice.templatePath = "Templates/daily.md";

		const app = createMockApp({
			existingPaths: {
				[templateChoice.templatePath]: "# Daily Template",
			},
		});

		const result = await buildPackage(app, {
			choices: [templateChoice],
			rootChoiceIds: [templateChoice.id],
			quickAddVersion: QUICKADD_VERSION,
		});

		expect(result.missingAssets).toHaveLength(0);
		expect(result.pkg.assets).toContainEqual(
			expect.objectContaining({
				originalPath: templateChoice.templatePath,
				kind: "template",
			}),
		);
	});

	it("buildPackage captures missing template assets", async () => {
		const templateChoice = new TemplateChoice("Daily Note");
		templateChoice.templatePath = "Templates/daily.md";

		const app = createMockApp();

		const result = await buildPackage(app, {
			choices: [templateChoice],
			rootChoiceIds: [templateChoice.id],
			quickAddVersion: QUICKADD_VERSION,
		});

		expect(result.pkg.assets).toHaveLength(0);
		expect(result.missingAssets).toContainEqual({
			path: templateChoice.templatePath,
			kind: "template",
		});
	});

	it("buildPackage embeds capture templates when configured", async () => {
		const captureChoice = new CaptureChoice("Capture");
		captureChoice.createFileIfItDoesntExist.enabled = true;
		captureChoice.createFileIfItDoesntExist.createWithTemplate = true;
		captureChoice.createFileIfItDoesntExist.template = "Templates/capture.md";

		const app = createMockApp({
			existingPaths: {
				[captureChoice.createFileIfItDoesntExist.template]: "Captured",
			},
		});

		const result = await buildPackage(app, {
			choices: [captureChoice],
			rootChoiceIds: [captureChoice.id],
			quickAddVersion: QUICKADD_VERSION,
		});

		expect(result.pkg.assets).toContainEqual(
			expect.objectContaining({
				originalPath: captureChoice.createFileIfItDoesntExist.template,
				kind: "capture-template",
			}),
		);
	});

	it("collects choices referenced by ChoiceCommand", async () => {
		const parent = new MacroChoice("Parent");
		const child = new MacroChoice("Child");

		parent.macro.commands.push(new ChoiceCommand("Run child", child.id));

		const app = createMockApp();

		const result = await buildPackage(app, {
			choices: [parent, child],
			rootChoiceIds: [parent.id],
			quickAddVersion: QUICKADD_VERSION,
		});

		expect(result.pkg.choices.map((c) => c.choice.id)).toEqual([
			parent.id,
			child.id,
		]);
	});

	it("omits excluded children from exported multi choices", async () => {
		const childA = new TemplateChoice("Template A");
		const childB = new TemplateChoice("Template B");
		const group = new MultiChoice("Group");
		group.choices.push(childA, childB);

		const app = createMockApp();

		const result = await buildPackage(app, {
			choices: [group],
			rootChoiceIds: [group.id],
			excludedChoiceIds: [childB.id],
			quickAddVersion: QUICKADD_VERSION,
		});

		expect(result.pkg.choices.map((entry) => entry.choice.id)).toEqual([
			group.id,
			childA.id,
		]);

		const exportedGroup = result.pkg.choices[0].choice as MultiChoice;
		expect(exportedGroup.choices?.map((choice) => choice.id)).toEqual([childA.id]);
	});

	it("writePackageToVault creates missing folders and writes file", async () => {
		const app = createMockApp();
	const pkg = {
		schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
			quickAddVersion: QUICKADD_VERSION,
			createdAt: new Date().toISOString(),
			rootChoiceIds: [],
			choices: [],
			assets: [],
		};

		await writePackageToVault(
			app,
			pkg,
			"QuickAdd Packages/test-package.quickadd.json",
		);

		const mockApp = app as unknown as {
			vault: {
				adapter: {
					write: ReturnType<typeof createMockApp>["vault"]["adapter"]["write"];
				};
				createFolder: ReturnType<typeof createMockApp>["vault"]["createFolder"];
			};
		};

		expect(mockApp.vault.createFolder).toHaveBeenCalledWith(
			"QuickAdd Packages",
		);
		expect(mockApp.vault.adapter.write).toHaveBeenCalledWith(
			"QuickAdd Packages/test-package.quickadd.json",
			JSON.stringify(pkg, null, 2),
		);
	});

	it("generateDefaultPackagePath produces predictable suffix", () => {
		const path = generateDefaultPackagePath();
		expect(path.startsWith("QuickAdd Packages/quickadd-package-")).toBe(true);
		expect(path.endsWith(".quickadd.json")).toBe(true);
	});
});
