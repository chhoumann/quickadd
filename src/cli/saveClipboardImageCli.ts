import type { CliData, CliFlags } from "obsidian";
import type QuickAdd from "../main";
import { saveClipboardImageToVault } from "../utils/clipboardImageAttachments";

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

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined || value === "") return undefined;
	const normalized = value.toLowerCase();
	if (
		normalized === "true" ||
		normalized === "1" ||
		normalized === "yes" ||
		normalized === "on"
	) {
		return true;
	}
	if (
		normalized === "false" ||
		normalized === "0" ||
		normalized === "no" ||
		normalized === "off"
	) {
		return false;
	}
	throw new Error(
		`Invalid nameAfterNoteTitle: ${value}. Use true or false.`,
	);
}

export async function saveClipboardImageHandler(
	plugin: QuickAdd,
	params: CliData,
): Promise<string> {
	try {
		const sourcePath =
			typeof params.sourcePath === "string" ? params.sourcePath : "";
		const nameAfterNoteTitle = parseOptionalBoolean(
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
		return JSON.stringify({
			ok: true,
			command: SAVE_CLIPBOARD_IMAGE_COMMAND,
			path: file.path,
			name: file.name,
			sourcePath: sourcePath || "",
			nameAfterNoteTitle:
				nameAfterNoteTitle ??
				plugin.settings.namePastedImagesAfterNoteTitle,
		});
	} catch (error) {
		return JSON.stringify({
			ok: false,
			command: SAVE_CLIPBOARD_IMAGE_COMMAND,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
