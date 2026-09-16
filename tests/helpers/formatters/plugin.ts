import type QuickAdd from "../../../src/main";

export function createSelectionFormatterPlugin(): QuickAdd {
	return {
		settings: {
			inputPrompt: "single-line",
			enableTemplatePropertyTypes: false,
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as QuickAdd;
}

export function createCaptureFormatterPlugin(): QuickAdd {
	return {
      settings: {
        enableTemplatePropertyTypes: false,
        globalVariables: {},
        showCaptureNotification: false,
        showInputCancellationNotification: true,
      },
    } as QuickAdd;
}
