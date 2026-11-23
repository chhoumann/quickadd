import type { FileOpeningSettings, OpenLocation } from "../../types/fileOpening";

// Shared by the Template/Capture builders and the macro "Open file" step, so the
// two places that set where a file opens offer the same choices under the same names.

export const openLocationOptions: { value: OpenLocation; label: string }[] = [
	{ value: "reuse", label: "Reuse current tab" },
	{ value: "tab", label: "New tab" },
	{ value: "split", label: "Split pane" },
	{ value: "window", label: "New window" },
	{ value: "left-sidebar", label: "Left sidebar" },
	{ value: "right-sidebar", label: "Right sidebar" },
];

export const splitDirectionOptions: {
	value: FileOpeningSettings["direction"];
	label: string;
}[] = [
	{ value: "vertical", label: "Split right" },
	{ value: "horizontal", label: "Split down" },
];
