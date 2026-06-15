import type { TFile } from "obsidian";
import {
	FieldSuggestionParser,
	type FieldFilter,
} from "./FieldSuggestionParser";
import {
	extractBareFlagPart,
	parsePipeKeyValue,
	splitPipeParts,
} from "./pipeSyntax";

// Namespaces FILE variable values in the variables map, separate from plain
// VALUE/FIELD variables (parallel to FIELD_VARIABLE_PREFIX in constants.ts).
export const FILE_VARIABLE_PREFIX = "FILE:";

// Internal encoding for a resolved FILE variable value. A value chosen from the
// folder list is stored as `@file:<vaultPath>`; a value typed via |custom is
// stored as `@filecustom:<text>` so rendering NEVER resolves a typed string back
// to a real file (which would let |custom bypass exclude-folder etc.). Mirrors
// VDATE's `@date:` sentinel. An empty string means "answered, intentionally empty"
// (optional skip). A value with neither prefix is treated as a raw path/name
// (script-seeded or one-page legacy) and resolved best-effort.
export const FILE_PICK_PREFIX = "@file:";
export const FILE_CUSTOM_PREFIX = "@filecustom:";

export type FileMode = "name" | "link" | "path";

export type ParsedFileToken = {
	raw: string;
	folderPath: string;
	mode: FileMode;
	label?: string;
	/** Explicit shared key from `|name:`; undefined when not provided. */
	aliasName?: string;
	optional: boolean;
	allowCustomInput: boolean;
	/** Reuses the FIELD file filter so folder/tag/exclude-* behave identically. */
	filter: FieldFilter;
	/** Variables-map key. Full token identity by default; `|name:` shares it. */
	variableKey: string;
};

const MODE_FLAGS = new Set<FileMode>(["name", "link", "path"]);

/** Strip leading/trailing slashes, matching EnhancedFieldSuggestionFileFilter. */
function normalizeFolder(path: string): string {
	return path.replace(/^\/+|\/+$/g, "");
}

/**
 * The slash- and order-insensitive part of the cache key that determines WHICH
 * files the picker lists (folder + tag/exclude-* filters). Two tokens that share
 * this list can meaningfully share a pick; two that don't, can't.
 */
function buildFileScopeSignature(folderPath: string, filter: FieldFilter): string {
	const parts = [`folder=${normalizeFolder(folderPath)}`];
	if (filter.tags?.length)
		parts.push(`tags=${[...filter.tags].sort().join(",")}`);
	if (filter.excludeFolders?.length)
		parts.push(
			`xfolder=${[...filter.excludeFolders]
				.map(normalizeFolder)
				.sort()
				.join(",")}`,
		);
	if (filter.excludeTags?.length)
		parts.push(`xtag=${[...filter.excludeTags].sort().join(",")}`);
	if (filter.excludeFiles?.length)
		parts.push(`xfile=${[...filter.excludeFiles].sort().join(",")}`);
	return parts.join("|");
}

/**
 * Full identity signature for an un-named token. Builds on the scope signature
 * and adds `mode`, `label`, `optional`, and `custom` so two prompts that differ
 * only by mode/label/flags are distinct identities — sharing one pick is the
 * explicit job of `|name:`.
 */
function buildFileSignature(parsed: {
	folderPath: string;
	mode: FileMode;
	label?: string;
	optional: boolean;
	allowCustomInput: boolean;
	filter: FieldFilter;
}): string {
	const { folderPath, mode, label, optional, allowCustomInput, filter } =
		parsed;
	const parts = [
		buildFileScopeSignature(folderPath, filter),
		`mode=${mode}`,
	];
	if (label) parts.push(`label=${label}`);
	if (optional) parts.push("optional");
	if (allowCustomInput) parts.push("custom");
	return parts.join("|");
}

/**
 * Parse the interior of a `{{FILE:<folder>|...}}` token.
 *
 * The first pipe-part is the (required) folder path. FILE-specific options are
 * peeled off here — the bare mode flags `name`/`link`/`path`, `optional`,
 * `custom`, and the key:value `label:` / `name:` — then the remainder is handed
 * to {@link FieldSuggestionParser.parse} so the folder/tag/exclude-* filter
 * grammar can never diverge from {{FIELD}}. The folder (first segment) is the
 * picker SCOPE, so it is applied as `filter.folder` regardless of any `|folder:`.
 *
 * Returns `null` for an empty folder (the token is left literal by the caller).
 */
export function parseFileToken(raw: string): ParsedFileToken | null {
	if (!raw) return null;

	const allParts = splitPipeParts(raw);
	const folderPath = (allParts.shift() ?? "").trim();
	if (!folderPath) return null;

	// Peel bare flags first.
	let remaining = allParts;
	const optionalResult = extractBareFlagPart(remaining, "optional");
	remaining = optionalResult.remaining;
	const optional = optionalResult.found;

	const customResult = extractBareFlagPart(remaining, "custom");
	remaining = customResult.remaining;
	const allowCustomInput = customResult.found;

	let mode: FileMode = "name";
	const afterMode: string[] = [];
	for (const part of remaining) {
		const trimmed = part.trim().toLowerCase();
		if (MODE_FLAGS.has(trimmed as FileMode)) {
			mode = trimmed as FileMode; // last one wins
			continue;
		}
		afterMode.push(part);
	}

	// Peel key:value options that are FILE-specific (label/name); everything else
	// (tag/exclude-*) is parsed by FieldSuggestionParser below.
	let label: string | undefined;
	let aliasName: string | undefined;
	for (const part of afterMode) {
		const parsed = parsePipeKeyValue(part);
		if (!parsed) continue;
		if (parsed.key === "label" && parsed.value) label = parsed.value;
		else if (parsed.key === "name" && parsed.value) aliasName = parsed.value;
	}

	// Delegate filter parsing to the shared FIELD parser (it skips unknown keys
	// like label/name and bare flags), then force the scope folder. The first
	// segment is the folder, so any `|folder:` sub-option the parser picks up is
	// intentionally discarded below (the positional folder always wins).
	const fieldParsed = FieldSuggestionParser.parse(raw);
	const filter: FieldFilter = {
		folder: folderPath,
		tags: fieldParsed.filters.tags,
		excludeFolders: fieldParsed.filters.excludeFolders,
		excludeTags: fieldParsed.filters.excludeTags,
		excludeFiles: fieldParsed.filters.excludeFiles,
	};

	// Sharing (`|name:`) is scoped to the picker's SCOPE (folder + filters): a pick
	// comes from one specific file list, so `{{FILE:People|name:ref}}` and
	// `{{FILE:Projects|name:ref}}` — or the same folder with different filters —
	// must not silently reuse each other's pick. Mode/label/optional/custom are
	// intentionally NOT in the alias key, so one pick renders across modes.
	const variableKey = aliasName
		? `${FILE_VARIABLE_PREFIX}name=${aliasName}|${buildFileScopeSignature(folderPath, filter)}`
		: `${FILE_VARIABLE_PREFIX}${buildFileSignature({
				folderPath,
				mode,
				label,
				optional,
				allowCustomInput,
				filter,
			})}`;

	return {
		raw,
		folderPath,
		mode,
		label,
		aliasName,
		optional,
		allowCustomInput,
		filter,
		variableKey,
	};
}

export type DecodedFileValue =
	| { kind: "empty" }
	| { kind: "file"; path: string }
	| { kind: "custom"; text: string }
	| { kind: "raw"; value: string };

/**
 * Canonicalize a FILE value submitted through the one-page input form, where the
 * suggester/dropdown stores either an encoded `@file:<path>` option (a real pick)
 * or raw typed text. Only a value that exactly matches one of the requirement's
 * encoded picks is trusted as a pick; anything else is treated as typed text and
 * wrapped as `@filecustom:<text>` verbatim. This stops a user from spoofing a
 * pick by typing the internal `@file:` sentinel into a |custom field. Empty
 * stays empty (an intentional skip).
 */
export function canonicalizeOnePageFileValue(
	value: string,
	validPicks: Iterable<string>,
): string {
	if (!value) return value;
	for (const pick of validPicks) {
		if (value === pick) return value;
	}
	return `${FILE_CUSTOM_PREFIX}${value}`;
}

/** Decode a stored FILE variable value into its representation kind. */
export function decodeFileValue(stored: unknown): DecodedFileValue {
	if (typeof stored !== "string" || stored === "") return { kind: "empty" };
	if (stored.startsWith(FILE_CUSTOM_PREFIX))
		return { kind: "custom", text: stored.slice(FILE_CUSTOM_PREFIX.length) };
	if (stored.startsWith(FILE_PICK_PREFIX))
		return { kind: "file", path: stored.slice(FILE_PICK_PREFIX.length) };
	return { kind: "raw", value: stored };
}

/** Basename of a vault path (drop folders + a trailing known extension). */
export function fileBasenameFromPath(value: string): string {
	const segment = value.split("/").pop() ?? value;
	return segment.replace(/\.(md|canvas|base)$/i, "");
}

/**
 * Display labels for a folder's files: basenames, with the parent folder
 * appended when a basename is ambiguous within the list so duplicate-named files
 * are still distinguishable in the picker.
 */
export function buildFileDisplayLabels(files: TFile[]): string[] {
	const counts = new Map<string, number>();
	for (const file of files) {
		counts.set(file.basename, (counts.get(file.basename) ?? 0) + 1);
	}
	return files.map((file) => {
		if ((counts.get(file.basename) ?? 0) <= 1) return file.basename;
		const parent = file.parent?.path;
		const where = parent && parent !== "/" ? parent : "vault root";
		return `${file.basename} (${where})`;
	});
}
