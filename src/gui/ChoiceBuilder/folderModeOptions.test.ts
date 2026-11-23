import { describe, expect, it } from "vitest";
import { folderModeDescriptions, folderModeOptions } from "./folderModeOptions";

describe("folderModeOptions", () => {
	// folderModeDescriptions is a Record<FolderMode, string>, so the compiler keeps
	// its keys complete; the dropdown must offer exactly those modes, in that order.
	it("exposes a dropdown option for every mode", () => {
		expect(folderModeOptions.map((o) => o.value)).toEqual(Object.keys(folderModeDescriptions));
	});
});
