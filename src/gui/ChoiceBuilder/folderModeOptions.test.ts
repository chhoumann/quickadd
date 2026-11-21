import { describe, expect, it } from "vitest";
import type { FolderMode } from "../../utils/folderMode";
import { folderModeOptions } from "./folderModeOptions";

const MODES: FolderMode[] = [
	"obsidian-default",
	"specified",
	"active-file",
	"prompt",
];

describe("folderModeOptions", () => {
	it("exposes a dropdown option for every mode", () => {
		expect(folderModeOptions.map((o) => o.value).sort()).toEqual(
			[...MODES].sort(),
		);
	});
});
