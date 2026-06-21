import {
	decodeFileValue,
	fileBasenameFromPath,
	type FileMode,
} from "../../utils/fileSyntax";

/**
 * Renders a stored `{{FILE:...}}` token value to the string(s) that replace the
 * token, by render mode (basename / wikilink / path).
 *
 * Pure: the only effectful concern — turning a real picked file into a wikilink
 * (which needs the vault + the caller's link settings/source path) — is injected
 * as `resolveLink`. Everything else (decode, basename, path, literal/custom
 * passthrough) is a deterministic transform of the stored value, so this stays
 * App-free and unit-testable. An array stored value (a `|multi` pick or a script
 * array) maps element-wise, mirroring how the token is later collected as a YAML
 * list.
 */
export function renderStoredFileValue(
	stored: unknown,
	mode: FileMode,
	resolveLink: (stored: unknown) => string,
): string | string[] {
	if (Array.isArray(stored)) {
		return stored.map((value) => renderSingleFileValue(value, mode, resolveLink));
	}
	return renderSingleFileValue(stored, mode, resolveLink);
}

function renderSingleFileValue(
	stored: unknown,
	mode: FileMode,
	resolveLink: (stored: unknown) => string,
): string {
	if (mode === "link") return resolveLink(stored);

	const decoded = decodeFileValue(stored);
	switch (decoded.kind) {
		case "empty":
			return "";
		case "file":
			return mode === "path"
				? decoded.path
				: fileBasenameFromPath(decoded.path);
		case "custom":
		case "raw":
			// Literal, user-provided text (a |custom type-in, a one-page typed
			// value, or a script-seeded string). It is NEVER resolved to a real
			// file — only a `@file:` pick from the filtered list is.
			return decoded.kind === "custom" ? decoded.text : decoded.value;
	}
}
