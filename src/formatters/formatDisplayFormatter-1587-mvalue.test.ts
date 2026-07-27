import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import type QuickAdd from "../main";

/**
 * Issue #1587, the BODY preview's half.
 *
 * The file-name row's half is pinned in `fileNameDisplayFormatter.test.ts`. Both
 * are needed: they are two rows of the same builder, and a regression in one
 * would have them contradict each other about the same token.
 */

const app = {
	workspace: { getActiveFile: () => null },
	vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
	metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
} as unknown as App;

const plugin = {
	settings: { globalVariables: {}, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

const makeFormatter = () => new FormatDisplayFormatter(app, plugin);

describe("FormatDisplayFormatter previews {{MVALUE}} (#1587)", () => {
	it("shows the math stand-in rather than the raw token", async () => {
		const formatter = makeFormatter();
		await expect(formatter.format("= {{MVALUE}}")).resolves.toBe(
			"= calculation_result",
		);
		// And reaches the stand-in WITHOUT opening the math modal: the inert
		// contract (#1558) covers this pass like every other one.
		expect(formatter.diagnostics.list()).toEqual([]);
	});

	it("prefers an already-collected answer", async () => {
		const formatter = makeFormatter();
		(formatter as unknown as { variables: Map<string, unknown> }).variables.set(
			"mvalue",
			"2+2",
		);
		await expect(formatter.format("= {{MVALUE}}")).resolves.toBe("= 2+2");
	});

	it("fills every occurrence from the one collected answer", async () => {
		const formatter = makeFormatter();
		(formatter as unknown as { variables: Map<string, unknown> }).variables.set(
			"mvalue",
			"2+2",
		);
		await expect(formatter.format("{{MVALUE}}-{{MVALUE}}")).resolves.toBe(
			"2+2-2+2",
		);
	});
});
