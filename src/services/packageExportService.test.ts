import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildPackage,
	generateDefaultPackagePath,
	writePackageToVault,
} from "./packageExportService";
import type { BuildPackageOptions } from "./packageExportService";
import { QUICKADD_PACKAGE_SCHEMA_VERSION } from "../types/packages/QuickAddPackage";
import type { QuickAddPackage } from "../types/packages/QuickAddPackage";
import { decodeFromBase64 } from "../utils/base64";
import { CommandType } from "../types/macros/CommandType";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

// --- Choice factory helpers (minimal but type-shaped) -----------------------

function makeTemplateChoice(
	id: string,
	name: string,
	templatePath: string,
): ITemplateChoice {
	return {
		id,
		name,
		type: "Template",
		command: false,
		templatePath,
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		fileNameFormat: { enabled: false, format: "" },
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab" as never,
			direction: "vertical",
			mode: "default" as never,
			focus: true,
		},
		fileExistsBehavior: "Nothing" as never,
	} as ITemplateChoice;
}

function makeCaptureChoice(
	id: string,
	name: string,
	template?: string,
): ICaptureChoice {
	return {
		id,
		name,
		type: "Capture",
		command: false,
		captureTo: "",
		captureToActiveFile: false,
		createFileIfItDoesntExist: {
			enabled: template !== undefined,
			createWithTemplate: template !== undefined,
			template: template ?? "",
		},
		format: { enabled: false, format: "" },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: false,
			after: "",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "",
		},
		newLineCapture: { enabled: false, direction: "below" },
		openFile: false,
		fileOpening: {
			location: "tab" as never,
			direction: "vertical",
			mode: "default" as never,
			focus: true,
		},
	} as ICaptureChoice;
}

function makeMacroChoice(
	id: string,
	name: string,
	commands: IMacroChoice["macro"]["commands"],
): IMacroChoice {
	return {
		id,
		name,
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: `${id}-macro`,
			name: `${name} macro`,
			commands,
		},
	} as IMacroChoice;
}

function makeMultiChoice(
	id: string,
	name: string,
	children: IChoice[],
): IMultiChoice {
	return {
		id,
		name,
		type: "Multi",
		command: false,
		collapsed: false,
		choices: children,
	} as IMultiChoice;
}

// --- Fake vault / app -------------------------------------------------------

interface FakeVaultControls {
	app: { vault: { adapter: any; createFolder: (p: string) => Promise<void> } };
	createdFolders: string[];
	writes: Array<{ path: string; content: string }>;
	files: Map<string, string>;
}

function makeFakeApp(
	options: {
		files?: Record<string, string>;
		existsImpl?: (path: string) => Promise<boolean> | boolean;
		readImpl?: (path: string) => Promise<string> | string;
	} = {},
): FakeVaultControls {
	const files = new Map<string, string>(Object.entries(options.files ?? {}));
	const createdFolders: string[] = [];
	const writes: Array<{ path: string; content: string }> = [];

	const adapter = {
		exists: vi.fn(async (path: string) => {
			if (options.existsImpl) return options.existsImpl(path);
			return files.has(path);
		}),
		read: vi.fn(async (path: string) => {
			if (options.readImpl) return options.readImpl(path);
			const content = files.get(path);
			if (content === undefined) {
				throw new Error(`No such file: ${path}`);
			}
			return content;
		}),
		write: vi.fn(async (path: string, content: string) => {
			writes.push({ path, content });
			files.set(path, content);
		}),
	};

	const app = {
		vault: {
			adapter,
			createFolder: vi.fn(async (p: string) => {
				createdFolders.push(p);
			}),
		},
	};

	return { app, createdFolders, writes, files };
}

function buildOptions(
	overrides: Partial<BuildPackageOptions> & Pick<BuildPackageOptions, "choices" | "rootChoiceIds">,
): BuildPackageOptions {
	return {
		quickAddVersion: "1.2.3",
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

// --- generateDefaultPackagePath --------------------------------------------

describe("generateDefaultPackagePath", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("produces a path under 'QuickAdd Packages' with a sanitized ISO timestamp", () => {
		vi.setSystemTime(new Date("2026-05-29T13:45:30.123Z"));

		const path = generateDefaultPackagePath();

		// ':' and '.' are replaced with '-'
		expect(path).toBe(
			"QuickAdd Packages/quickadd-package-2026-05-29T13-45-30-123Z.quickadd.json",
		);
	});

	it("never includes ':' or '.' from the timestamp (only the file extension dots)", () => {
		vi.setSystemTime(new Date("2026-12-31T23:59:59.999Z"));

		const path = generateDefaultPackagePath();
		const timestampPart = path
			.replace("QuickAdd Packages/quickadd-package-", "")
			.replace(".quickadd.json", "");

		expect(timestampPart).not.toContain(":");
		expect(timestampPart).not.toContain(".");
		expect(path.endsWith(".quickadd.json")).toBe(true);
	});
});

// --- buildPackage -----------------------------------------------------------

describe("buildPackage", () => {
	it("builds a package for a single template choice with its template asset", async () => {
		const template = makeTemplateChoice("t1", "Daily", "Templates/daily.md");
		const { app } = makeFakeApp({
			files: { "Templates/daily.md": "# Daily {{date}}" },
		});

		const result = await buildPackage(
			app as never,
			buildOptions({ choices: [template], rootChoiceIds: ["t1"] }),
		);

		expect(result.pkg.schemaVersion).toBe(QUICKADD_PACKAGE_SCHEMA_VERSION);
		expect(result.pkg.quickAddVersion).toBe("1.2.3");
		expect(result.pkg.createdAt).toBe("2026-01-01T00:00:00.000Z");
		expect(result.pkg.rootChoiceIds).toEqual(["t1"]);

		expect(result.pkg.choices).toHaveLength(1);
		expect(result.pkg.choices[0].choice.id).toBe("t1");
		expect(result.pkg.choices[0].parentChoiceId).toBeNull();
		expect(result.pkg.choices[0].pathHint).toEqual(["Daily"]);

		expect(result.missingChoiceIds).toEqual([]);
		expect(result.missingAssets).toEqual([]);

		expect(result.pkg.assets).toHaveLength(1);
		const asset = result.pkg.assets[0];
		expect(asset.kind).toBe("template");
		expect(asset.originalPath).toBe("Templates/daily.md");
		expect(asset.contentEncoding).toBe("base64");
		expect(decodeFromBase64(asset.content)).toBe("# Daily {{date}}");
	});

	it("defaults createdAt to the current time when not provided", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-15T08:00:00.000Z"));
		try {
			const choice = makeTemplateChoice("t1", "T", "Templates/a.md");
			const { app } = makeFakeApp({ files: { "Templates/a.md": "x" } });

			const result = await buildPackage(
				app as never,
				{
					choices: [choice],
					rootChoiceIds: ["t1"],
					quickAddVersion: "9.9.9",
				},
			);

			expect(result.pkg.createdAt).toBe("2026-03-15T08:00:00.000Z");
		} finally {
			vi.useRealTimers();
		}
	});

	it("includes child choices reachable through a Multi choice and records pathHint/parent", async () => {
		const child = makeTemplateChoice("c1", "Child", "Templates/child.md");
		const multi = makeMultiChoice("m1", "Parent", [child]);
		const { app } = makeFakeApp({
			files: { "Templates/child.md": "child body" },
		});

		const result = await buildPackage(
			app as never,
			buildOptions({ choices: [multi], rootChoiceIds: ["m1"] }),
		);

		const ids = result.pkg.choices.map((c) => c.choice.id);
		expect(ids).toContain("m1");
		expect(ids).toContain("c1");

		const childEntry = result.pkg.choices.find((c) => c.choice.id === "c1");
		expect(childEntry?.parentChoiceId).toBe("m1");
		expect(childEntry?.pathHint).toEqual(["Parent", "Child"]);
	});

	it("prunes excluded children out of an included Multi choice's choices array", async () => {
		const keep = makeTemplateChoice("keep", "Keep", "Templates/keep.md");
		const drop = makeTemplateChoice("drop", "Drop", "Templates/drop.md");
		const multi = makeMultiChoice("m1", "Parent", [keep, drop]);
		const { app } = makeFakeApp({
			files: {
				"Templates/keep.md": "keep",
				"Templates/drop.md": "drop",
			},
		});

		const result = await buildPackage(
			app as never,
			buildOptions({
				choices: [multi],
				rootChoiceIds: ["m1"],
				excludedChoiceIds: ["drop"],
			}),
		);

		const ids = result.pkg.choices.map((c) => c.choice.id);
		expect(ids).toContain("m1");
		expect(ids).toContain("keep");
		expect(ids).not.toContain("drop");

		// The cloned Multi choice should only retain the kept child.
		const multiEntry = result.pkg.choices.find((c) => c.choice.id === "m1");
		const multiChoice = multiEntry?.choice as IMultiChoice;
		expect(multiChoice.choices.map((c) => c.id)).toEqual(["keep"]);

		// Only the kept template asset is encoded.
		const assetPaths = result.pkg.assets.map((a) => a.originalPath);
		expect(assetPaths).toContain("Templates/keep.md");
		expect(assetPaths).not.toContain("Templates/drop.md");
	});

	it("does not mutate the original choices when pruning (works on a deep clone)", async () => {
		const keep = makeTemplateChoice("keep", "Keep", "Templates/keep.md");
		const drop = makeTemplateChoice("drop", "Drop", "Templates/drop.md");
		const multi = makeMultiChoice("m1", "Parent", [keep, drop]);
		const { app } = makeFakeApp({
			files: {
				"Templates/keep.md": "keep",
				"Templates/drop.md": "drop",
			},
		});

		await buildPackage(
			app as never,
			buildOptions({
				choices: [multi],
				rootChoiceIds: ["m1"],
				excludedChoiceIds: ["drop"],
			}),
		);

		// Source structure untouched.
		expect(multi.choices.map((c) => c.id)).toEqual(["keep", "drop"]);
	});

	it("excludes a root choice entirely when its id is in excludedChoiceIds", async () => {
		const a = makeTemplateChoice("a", "A", "Templates/a.md");
		const b = makeTemplateChoice("b", "B", "Templates/b.md");
		const { app } = makeFakeApp({
			files: { "Templates/a.md": "a", "Templates/b.md": "b" },
		});

		const result = await buildPackage(
			app as never,
			buildOptions({
				choices: [a, b],
				rootChoiceIds: ["a", "b"],
				excludedChoiceIds: ["a"],
			}),
		);

		expect(result.pkg.choices.map((c) => c.choice.id)).toEqual(["b"]);
		// rootChoiceIds is normalized to only included ids.
		expect(result.pkg.rootChoiceIds).toEqual(["b"]);
	});

	it("reports root ids not present in any choice as missingChoiceIds and omits them from roots", async () => {
		const real = makeTemplateChoice("real", "Real", "Templates/real.md");
		const { app } = makeFakeApp({ files: { "Templates/real.md": "r" } });

		const result = await buildPackage(
			app as never,
			buildOptions({
				choices: [real],
				rootChoiceIds: ["real", "ghost"],
			}),
		);

		expect(result.missingChoiceIds).toContain("ghost");
		expect(result.pkg.rootChoiceIds).toEqual(["real"]);
		expect(result.pkg.choices.map((c) => c.choice.id)).toEqual(["real"]);
	});

	it("collects user-script and conditional-script assets from a macro choice", async () => {
		const macro = makeMacroChoice("macro1", "Macro", [
			{
				id: "cmd-us",
				name: "Run script",
				type: CommandType.UserScript,
				path: "Scripts/userScript.js",
				settings: {},
			} as never,
			{
				id: "cmd-cond",
				name: "If",
				type: CommandType.Conditional,
				condition: {
					mode: "script",
					scriptPath: "Scripts/condition.js",
				},
				thenCommands: [],
				elseCommands: [],
			} as never,
		]);
		const { app } = makeFakeApp({
			files: {
				"Scripts/userScript.js": "module.exports = () => {};",
				"Scripts/condition.js": "module.exports = () => true;",
			},
		});

		const result = await buildPackage(
			app as never,
			buildOptions({ choices: [macro], rootChoiceIds: ["macro1"] }),
		);

		const byPath = new Map(
			result.pkg.assets.map((a) => [a.originalPath, a.kind]),
		);
		expect(byPath.get("Scripts/userScript.js")).toBe("user-script");
		expect(byPath.get("Scripts/condition.js")).toBe("conditional-script");
		expect(result.missingAssets).toEqual([]);
	});

	it("collects capture-template assets from a Capture choice", async () => {
		const capture = makeCaptureChoice(
			"cap1",
			"Capture",
			"Templates/capture.md",
		);
		const { app } = makeFakeApp({
			files: { "Templates/capture.md": "capture body" },
		});

		const result = await buildPackage(
			app as never,
			buildOptions({ choices: [capture], rootChoiceIds: ["cap1"] }),
		);

		expect(result.pkg.assets).toHaveLength(1);
		expect(result.pkg.assets[0].kind).toBe("capture-template");
		expect(result.pkg.assets[0].originalPath).toBe("Templates/capture.md");
	});

	it("records missing assets when the file does not exist and does not encode them", async () => {
		const template = makeTemplateChoice(
			"t1",
			"Daily",
			"Templates/missing.md",
		);
		// No files registered -> exists() returns false.
		const { app } = makeFakeApp({ files: {} });

		const result = await buildPackage(
			app as never,
			buildOptions({ choices: [template], rootChoiceIds: ["t1"] }),
		);

		expect(result.pkg.assets).toEqual([]);
		expect(result.missingAssets).toEqual([
			{ path: "Templates/missing.md", kind: "template" },
		]);
	});

	it("records a missing asset when reading throws, without rejecting", async () => {
		const template = makeTemplateChoice("t1", "Daily", "Templates/x.md");
		const { app } = makeFakeApp({
			existsImpl: () => true,
			readImpl: () => {
				throw new Error("read boom");
			},
		});

		const result = await buildPackage(
			app as never,
			buildOptions({ choices: [template], rootChoiceIds: ["t1"] }),
		);

		expect(result.pkg.assets).toEqual([]);
		expect(result.missingAssets).toEqual([
			{ path: "Templates/x.md", kind: "template" },
		]);
	});

	it("produces an empty package for an empty choice/root set", async () => {
		const { app } = makeFakeApp();

		const result = await buildPackage(
			app as never,
			buildOptions({ choices: [], rootChoiceIds: [] }),
		);

		expect(result.pkg.choices).toEqual([]);
		expect(result.pkg.rootChoiceIds).toEqual([]);
		expect(result.pkg.assets).toEqual([]);
		expect(result.missingChoiceIds).toEqual([]);
		expect(result.missingAssets).toEqual([]);
	});

	it("deduplicates a shared asset path across two choices into a single asset", async () => {
		const shared = "Templates/shared.md";
		const a = makeTemplateChoice("a", "A", shared);
		const b = makeTemplateChoice("b", "B", shared);
		const { app, files } = makeFakeApp({ files: { [shared]: "shared body" } });

		const result = await buildPackage(
			app as never,
			buildOptions({ choices: [a, b], rootChoiceIds: ["a", "b"] }),
		);

		const sharedAssets = result.pkg.assets.filter(
			(asset) => asset.originalPath === shared,
		);
		expect(sharedAssets).toHaveLength(1);
		// adapter.read should only have been called once for the deduped path.
		const reads = (app.vault.adapter.read as ReturnType<typeof vi.fn>).mock.calls.filter(
			(call) => call[0] === shared,
		);
		expect(reads).toHaveLength(1);
		expect(files.get(shared)).toBe("shared body");
	});
});

// --- writePackageToVault ----------------------------------------------------

describe("writePackageToVault", () => {
	function makePackage(): QuickAddPackage {
		return {
			schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
			quickAddVersion: "1.0.0",
			createdAt: "2026-01-01T00:00:00.000Z",
			rootChoiceIds: ["a"],
			choices: [],
			assets: [],
		};
	}

	it("writes pretty-printed JSON to the normalized output path", async () => {
		const pkg = makePackage();
		const { app, writes } = makeFakeApp({ existsImpl: () => true });

		await writePackageToVault(
			app as never,
			pkg,
			"QuickAdd Packages/out.quickadd.json",
		);

		expect(writes).toHaveLength(1);
		expect(writes[0].path).toBe("QuickAdd Packages/out.quickadd.json");
		// 2-space indentation -> contains a newline + indentation.
		expect(writes[0].content).toBe(JSON.stringify(pkg, null, 2));
		expect(JSON.parse(writes[0].content)).toEqual(pkg);
	});

	it("normalizes backslashes to forward slashes and trims surrounding whitespace", async () => {
		const pkg = makePackage();
		const { app, writes } = makeFakeApp({ existsImpl: () => true });

		await writePackageToVault(
			app as never,
			pkg,
			"  QuickAdd Packages\\nested\\out.json  ",
		);

		expect(writes[0].path).toBe("QuickAdd Packages/nested/out.json");
	});

	it("creates missing parent folders in order before writing", async () => {
		const pkg = makePackage();
		const existing = new Set<string>();
		const { app, createdFolders, writes } = makeFakeApp({
			existsImpl: (p) => existing.has(p),
		});
		// Track folders as created so re-checks would pass (mirrors real adapter).
		(app.vault.createFolder as ReturnType<typeof vi.fn>).mockImplementation(
			async (p: string) => {
				existing.add(p);
				createdFolders.push(p);
			},
		);

		await writePackageToVault(
			app as never,
			pkg,
			"A/B/C/file.json",
		);

		expect(createdFolders).toEqual(["A", "A/B", "A/B/C"]);
		expect(writes[0].path).toBe("A/B/C/file.json");
	});

	it("does not create folders that already exist", async () => {
		const pkg = makePackage();
		const { app, createdFolders } = makeFakeApp({
			existsImpl: () => true,
		});

		await writePackageToVault(app as never, pkg, "Existing/file.json");

		expect(createdFolders).toEqual([]);
		expect(app.vault.createFolder).not.toHaveBeenCalled();
	});

	it("writes to a top-level path without creating any folders", async () => {
		const pkg = makePackage();
		const { app, createdFolders, writes } = makeFakeApp({
			existsImpl: () => false,
		});

		await writePackageToVault(app as never, pkg, "root.json");

		expect(createdFolders).toEqual([]);
		expect(writes[0].path).toBe("root.json");
	});

	it("throws when the output path is empty or whitespace-only", async () => {
		const pkg = makePackage();
		const { app, writes } = makeFakeApp();

		await expect(
			writePackageToVault(app as never, pkg, "   "),
		).rejects.toThrow("Output path cannot be empty.");

		expect(writes).toEqual([]);
		expect(app.vault.adapter.write).not.toHaveBeenCalled();
	});
});
