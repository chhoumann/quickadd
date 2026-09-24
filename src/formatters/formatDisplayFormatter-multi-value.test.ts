import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import type QuickAdd from "../main";

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

describe("FormatDisplayFormatter previews a multi-select {{VALUE}}", () => {
	it("shows the options stand-in instead of dropping the token", async () => {
		await expect(makeFormatter().format("{{VALUE:focus,career|multi}}\nto-review"))
			.resolves.toBe("focus (2 options)\nto-review");
	});
});
