import { describe, expect, it } from "vitest";
import type { TemplateFolderConfig } from "../../types/choices/ITemplateChoice";
import {
	applyFolderMode,
	deriveFolderMode,
	folderModeOptions,
	type FolderMode,
} from "./folderMode";

const MODES: FolderMode[] = [
	"obsidian-default",
	"specified",
	"active-file",
	"prompt",
];

function config(
	overrides: Partial<TemplateFolderConfig> = {},
): TemplateFolderConfig {
	return {
		enabled: false,
		folders: [],
		chooseWhenCreatingNote: false,
		createInSameFolderAsActiveFile: false,
		chooseFromSubfolders: false,
		...overrides,
	};
}

/**
 * Independent oracle: which mode TemplateChoiceEngine.getFolderPath() resolves a
 * config to, modelled directly from its branch precedence (TemplateChoiceEngine.ts
 * run() else-branch + getFolderPath branches 1-4). If deriveFolderMode ever drifts
 * from the engine, this disagrees.
 */
function engineMode(f: TemplateFolderConfig): FolderMode {
	if (!f.enabled) return "obsidian-default"; // run(): folder.enabled === false
	// branch 1: chooseFromSubfolders gated by !(cwn || cisf) -> specified family
	if (
		f.chooseFromSubfolders &&
		!(f.chooseWhenCreatingNote || f.createInSameFolderAsActiveFile)
	)
		return "specified";
	if (f.chooseWhenCreatingNote) return "prompt"; // branch 2
	if (f.createInSameFolderAsActiveFile) return "active-file"; // branch 3
	return "specified"; // branch 4 (folders list)
}

// All 16 combinations of the four booleans.
const ALL_COMBOS: TemplateFolderConfig[] = [];
for (const enabled of [false, true])
	for (const chooseWhenCreatingNote of [false, true])
		for (const createInSameFolderAsActiveFile of [false, true])
			for (const chooseFromSubfolders of [false, true])
				ALL_COMBOS.push(
					config({
						enabled,
						chooseWhenCreatingNote,
						createInSameFolderAsActiveFile,
						chooseFromSubfolders,
						folders: ["Notes"],
					}),
				);

describe("deriveFolderMode", () => {
	it("matches the engine's resolved mode for all 16 boolean combinations", () => {
		for (const f of ALL_COMBOS) {
			expect(deriveFolderMode(f)).toBe(engineMode(f));
		}
	});

	it("folds the legacy 'both prompt and active' combo to 'prompt' (engine branch 2)", () => {
		const legacy = config({
			enabled: true,
			chooseWhenCreatingNote: true,
			createInSameFolderAsActiveFile: true,
		});
		expect(deriveFolderMode(legacy)).toBe("prompt");
		expect(engineMode(legacy)).toBe("prompt");
	});

	it("treats the subfolder-prompt combo as the 'specified' family", () => {
		const subfolders = config({
			enabled: true,
			chooseFromSubfolders: true,
			folders: ["Notes"],
		});
		expect(deriveFolderMode(subfolders)).toBe("specified");
	});
});

describe("applyFolderMode", () => {
	it("round-trips: deriveFolderMode(applyFolderMode(f, m)) === m", () => {
		for (const f of ALL_COMBOS) {
			for (const mode of MODES) {
				expect(deriveFolderMode(applyFolderMode(f, mode))).toBe(mode);
			}
		}
	});

	it("produces flags the engine resolves back to the chosen mode", () => {
		for (const f of ALL_COMBOS) {
			for (const mode of MODES) {
				expect(engineMode(applyFolderMode(f, mode))).toBe(mode);
			}
		}
	});

	it("preserves the folders[] list across every mode switch", () => {
		const withFolders = config({
			enabled: true,
			folders: ["Notes", "Journal/2026"],
		});
		for (const mode of MODES) {
			expect(applyFolderMode(withFolders, mode).folders).toEqual([
				"Notes",
				"Journal/2026",
			]);
		}
	});

	it("preserves chooseFromSubfolders across every mode switch (matches the old form)", () => {
		const withSubfolders = config({
			enabled: true,
			chooseFromSubfolders: true,
			folders: ["Notes"],
		});
		for (const mode of MODES) {
			expect(applyFolderMode(withSubfolders, mode).chooseFromSubfolders).toBe(
				true,
			);
		}
		// And a false value stays false everywhere.
		const noSubfolders = config({ enabled: true, folders: ["Notes"] });
		for (const mode of MODES) {
			expect(applyFolderMode(noSubfolders, mode).chooseFromSubfolders).toBe(
				false,
			);
		}
	});

	it("does not mutate the input config", () => {
		const original = config({ enabled: true, folders: ["Notes"] });
		const snapshot = JSON.parse(JSON.stringify(original));
		applyFolderMode(original, "prompt");
		expect(original).toEqual(snapshot);
	});

	it("exposes a dropdown option for every mode", () => {
		expect(folderModeOptions.map((o) => o.value).sort()).toEqual(
			[...MODES].sort(),
		);
	});
});
