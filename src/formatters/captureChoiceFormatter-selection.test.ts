import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

const { promptMock } = vi.hoisted(() => ({
	promptMock: vi.fn().mockResolvedValue("prompted"),
}));

vi.mock("../gui/InputPrompt", () => ({
	__esModule: true,
	default: class {
		factory() {
			return {
				Prompt: promptMock,
				PromptWithContext: promptMock,
			} as any;
		}
	},
}));

vi.mock("../quickAddSettingsTab", () => ({
	QuickAddSettingsTab: class {},
}));

vi.mock("../main", () => ({
	__esModule: true,
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));

const createFormatter = (selection: string | null) => {
	const app = {
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(
				selection === null
					? null
					: {
							editor: {
								getSelection: () => selection,
							},
						},
			),
			getActiveFile: vi.fn().mockReturnValue(null),
		},
	} as unknown as App;

	const plugin = {
		settings: {
			inputPrompt: "single-line",
			enableTemplatePropertyTypes: false,
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as any;

	return new CaptureChoiceFormatter(app, plugin);
};

describe("CaptureChoiceFormatter selection-as-value behavior", () => {
	beforeEach(() => {
		promptMock.mockClear();
	});

	it("uses selection for {{VALUE}} when enabled", async () => {
		const formatter = createFormatter("Selected text");
		formatter.setUseSelectionAsCaptureValue(true);

		const result = await formatter.formatContentOnly("{{VALUE}}");

		expect(result).toBe("Selected text");
		expect(promptMock).not.toHaveBeenCalled();
	});

	it("prompts for {{VALUE}} when selection use is disabled", async () => {
		const formatter = createFormatter("Selected text");
		formatter.setUseSelectionAsCaptureValue(false);

		const result = await formatter.formatContentOnly(
			"Value: {{VALUE}} / Selected: {{SELECTED}}",
		);

		expect(result).toBe("Value: prompted / Selected: Selected text");
		expect(promptMock).toHaveBeenCalledTimes(1);
	});

	it("treats whitespace-only selection as empty when enabled", async () => {
		const formatter = createFormatter("   \n\t ");
		formatter.setUseSelectionAsCaptureValue(true);

		const result = await formatter.formatContentOnly("{{VALUE}}");

		expect(result).toBe("prompted");
		expect(promptMock).toHaveBeenCalledTimes(1);
	});
});
