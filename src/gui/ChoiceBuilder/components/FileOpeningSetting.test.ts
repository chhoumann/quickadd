import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import FileOpeningSetting from "./FileOpeningSetting.svelte";
import type { FileOpeningSettings } from "../../../utils/fileOpeningDefaults";

function settingNames(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll(".setting-item-name")).map(
		(el) => el.textContent ?? "",
	);
}

const base = (
	overrides: Partial<FileOpeningSettings> = {},
): FileOpeningSettings => ({
	location: "tab",
	direction: "vertical",
	mode: "default",
	focus: true,
	...overrides,
});

describe("FileOpeningSetting", () => {
	it("hides Split Direction unless location is split", () => {
		const { container } = render(FileOpeningSetting, {
			props: { fileOpening: base({ location: "tab" }), contextLabel: "captured" },
		});
		expect(settingNames(container)).not.toContain("Split Direction");
		expect(settingNames(container)).toContain("File Opening Location");
		expect(settingNames(container)).toContain("View Mode");
	});

	it("shows Split Direction when location is split", () => {
		const { container } = render(FileOpeningSetting, {
			props: {
				fileOpening: base({ location: "split" }),
				contextLabel: "created",
			},
		});
		expect(settingNames(container)).toContain("Split Direction");
	});

	it("hides Focus new pane when location is reuse", () => {
		const { container } = render(FileOpeningSetting, {
			props: {
				fileOpening: base({ location: "reuse" }),
				contextLabel: "captured",
			},
		});
		expect(settingNames(container)).not.toContain("Focus new pane");
	});
});
