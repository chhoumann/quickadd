import { describe, it, expect, vi } from "vitest";
import { TemplateEngine } from "./TemplateEngine";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";

// normalizeTemplateFilePath is the shared chokepoint that assembles the
// vault-relative path for BOTH the create flow (TemplateChoiceEngine) and the
// "Apply template to active note" relocation flow (TemplateInsertEngine ->
// computeChoiceTargetPath -> createFolder + fileManager.renameFile). The relocation
// flow's FOLDER portion is NOT run through normalizeGeneratedFilePath and is NOT
// guarded by validateFolderPath, so a synced/shared malicious Template choice whose
// folder is "../../../evil" would otherwise assemble an out-of-vault target and move
// the note outside the vault. Assert the assembled path is vault-contained.

vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: vi.fn(function CompleteFormatterMock() {
		return {
			setTargetFolderPath: vi.fn(),
			setTitle: vi.fn(),
		};
	}),
}));

class TestTemplateEngine extends TemplateEngine {
	public constructor(
		app: App,
		plugin: QuickAdd,
		choiceExecutor: IChoiceExecutor,
	) {
		super(app, plugin, choiceExecutor);
	}

	public async run(): Promise<void> {}

	public normalize(
		folderPath: string,
		fileName: string,
		templatePath: string,
	): string {
		return this.normalizeTemplateFilePath(folderPath, fileName, templatePath);
	}
}

function makeEngine(): TestTemplateEngine {
	const app = {
		vault: { getAbstractFileByPath: vi.fn(() => null) },
		plugins: { plugins: { "templater-obsidian": null } },
	} as unknown as App;
	return new TestTemplateEngine(app, {} as QuickAdd, {} as IChoiceExecutor);
}

describe("normalizeTemplateFilePath vault containment", () => {
	const engine = makeEngine();

	it("assembles ordinary in-vault paths unchanged", () => {
		expect(engine.normalize("Projects/Sub", "Note", "t.md")).toBe(
			"Projects/Sub/Note.md",
		);
		expect(engine.normalize("", "Note", "t.md")).toBe("Note.md");
	});

	it("treats a leading-slash folder as in-vault root-relative (not an escape)", () => {
		// "/etc" -> stripLeadingSlash -> "etc": the documented root-relative convention,
		// contained inside the vault. Only genuine traversal/drive/UNC escapes are rejected.
		expect(engine.normalize("/etc", "Note", "t.md")).toBe("etc/Note.md");
	});

	// The folder portion is the relocation gap: it bypasses normalizeGeneratedFilePath.
	const escapingFolders = [
		"../../../evil", // POSIX traversal in the folder
		"..\\..\\..\\evil", // Windows backslash traversal
		"C:/Windows", // drive-absolute folder
		"C:\\Windows", // drive-absolute folder, backslash
		"\\\\server\\share", // UNC
	];
	for (const folder of escapingFolders) {
		it(`refuses an out-of-vault folder portion: ${JSON.stringify(folder)}`, () => {
			expect(() => engine.normalize(folder, "Note", "t.md")).toThrow(
				/outside the vault/,
			);
		});
	}

	it("refuses the Windows trailing-space '..' collapse in the folder portion", () => {
		// On Windows the filesystem strips trailing spaces/dots per component, so
		// ".. " becomes the parent ".." at file-open. A lexical "=== '..'" check
		// misses it; the boundary must catch the collapsed form.
		expect(() => engine.normalize(".. /.. /evil", "Note", "t.md")).toThrow(
			/outside the vault/,
		);
	});

	it("refuses traversal that appears only in the assembled file name", () => {
		// Defense in depth: even a folder of "" with a traversal that slipped past
		// the name normalizer must not assemble an escaping path.
		expect(() => engine.normalize("Projects", "..\\..\\evil", "t.md")).toThrow();
	});
});
