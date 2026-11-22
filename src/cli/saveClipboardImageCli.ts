import type { CliData, CliFlags } from "obsidian";
import type { AppProvider, SettingsProvider } from "../types/pluginContext";
import { saveClipboardImageToVault } from "../utils/clipboardImageAttachments";
import { parseBooleanFlag } from "./params";

export const SAVE_CLIPBOARD_IMAGE_COMMAND = "quickadd:save-clipboard-image";

export const SAVE_CLIPBOARD_IMAGE_FLAGS: CliFlags = {
	sourcePath: {
		value: "<vault-path>",
		description:
			"Note path the image will live in (capture destination). Empty keeps a vault-root attachment.",
	},
	nameAfterNoteTitle: {
		value: "<true|false>",
		description:
			"Override the Name pasted images after the note title setting for this save",
	},
};

const ONE_PIXEL_PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	),
	(char) => char.charCodeAt(0),
);

export async function saveClipboardImageHandler(
	plugin: AppProvider & SettingsProvider,
	params: CliData,
) {
	const sourcePath =
		typeof params.sourcePath === "string" ? params.sourcePath : "";
	const nameAfterNoteTitle = parseBooleanFlag(
		"nameAfterNoteTitle",
		typeof params.nameAfterNoteTitle === "string"
			? params.nameAfterNoteTitle
			: undefined,
	);
	const file = await saveClipboardImageToVault(
		plugin.app,
		ONE_PIXEL_PNG.buffer,
		"image/png",
		sourcePath,
		nameAfterNoteTitle === undefined
			? undefined
			: { nameAfterNoteTitle },
	);
	return {
		ok: true,
		path: file.path,
		name: file.name,
		sourcePath,
		nameAfterNoteTitle:
			nameAfterNoteTitle ??
			plugin.settings.namePastedImagesAfterNoteTitle,
	};
}
