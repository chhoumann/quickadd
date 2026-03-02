import { Setting } from "obsidian";
import type { FileViewMode2, OpenLocation } from "../../types/fileOpening";
import {
	normalizeFileOpening,
	type FileOpeningSettings,
} from "../../utils/fileOpeningDefaults";

export function renderOnePageOverrideSetting(options: {
	parent: HTMLElement;
	value: string | undefined;
	onChange: (value: string | undefined) => void;
}): void {
	new Setting(options.parent)
		.setName("One-page input override")
		.setDesc(
			"Override the global setting for this choice. 'Always' forces the one-page modal even if disabled globally; 'Never' disables it even if enabled globally.",
		)
		.addDropdown((dropdown) => {
			dropdown.addOptions({
				"": "Follow global setting",
				always: "Always",
				never: "Never",
			});
			dropdown.setValue(options.value ?? "");
			dropdown.onChange((val: string) => {
				options.onChange(val === "" ? undefined : val);
			});
		});
}

export function renderOpenFileToggleSetting(options: {
	parent: HTMLElement;
	value: boolean;
	description: string;
	onChange: (value: boolean) => void;
}): void {
	new Setting(options.parent)
		.setName("Open")
		.setDesc(options.description)
		.addToggle((toggle) => {
			toggle.setValue(options.value);
			toggle.onChange(options.onChange);
		});
}

export function renderFileOpeningSettings(options: {
	parent: HTMLElement;
	contextLabel: string;
	fileOpening: Partial<FileOpeningSettings> | null | undefined;
	onLocationChange: () => void;
}): FileOpeningSettings {
	const fileOpening = normalizeFileOpening(options.fileOpening);

	new Setting(options.parent)
		.setName("File Opening Location")
		.setDesc(`Where to open the ${options.contextLabel} file`)
		.addDropdown((dropdown) => {
			dropdown.addOptions({
				reuse: "Reuse current tab",
				tab: "New tab",
				split: "Split pane",
				window: "New window",
				"left-sidebar": "Left sidebar",
				"right-sidebar": "Right sidebar",
			});
			dropdown.setValue(fileOpening.location);
			dropdown.onChange((value: string) => {
				fileOpening.location = value as OpenLocation;
				options.onLocationChange();
			});
		});

	if (fileOpening.location === "split") {
		new Setting(options.parent)
			.setName("Split Direction")
			.setDesc("How to arrange the new pane relative to the current one")
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					vertical: "Split right",
					horizontal: "Split down",
				});
				dropdown.setValue(fileOpening.direction);
				dropdown.onChange((value: string) => {
					fileOpening.direction = value as "vertical" | "horizontal";
				});
			});
	}

	new Setting(options.parent)
		.setName("View Mode")
		.setDesc("How to display the opened file")
		.addDropdown((dropdown) => {
			dropdown.addOptions({
				source: "Source",
				preview: "Preview",
				live: "Live Preview",
				default: "Default",
			});
			dropdown.setValue(
				typeof fileOpening.mode === "string"
					? (fileOpening.mode as string)
					: "default",
			);
			dropdown.onChange((value: string) => {
				fileOpening.mode = value as FileViewMode2;
			});
		});

	if (fileOpening.location !== "reuse") {
		new Setting(options.parent)
			.setName("Focus new pane")
			.setDesc("Focus the opened tab immediately after opening")
			.addToggle((toggle) =>
				toggle.setValue(fileOpening.focus).onChange((value) => {
					fileOpening.focus = value;
				}),
			);
	}

	return fileOpening;
}
