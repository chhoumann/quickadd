const CONTROL_OR_LINE_SEPARATOR_CHARS = `${String.fromCharCode(0x00)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}\u2028\u2029`;
const STARTS_WITH_CONTROL_OR_LINE_SEPARATOR = new RegExp(
	`^ *[${CONTROL_OR_LINE_SEPARATOR_CHARS}]`,
	"u",
);
const ENDS_WITH_CONTROL_OR_LINE_SEPARATOR = new RegExp(
	`[${CONTROL_OR_LINE_SEPARATOR_CHARS}] *$`,
	"u",
);

function isControlOrLineSeparator(code: number): boolean {
	return (
		code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029
	);
}

// Linear: each run of control or line-separator characters, with the spaces
// around it, becomes one space. A regex backtracked quadratically on long space
// runs, and these names embed untrusted format output.
function collapseControlRunsWithSpaces(value: string): string {
	let out = "";
	let i = 0;
	while (i < value.length) {
		let j = i;
		while (j < value.length && value.charCodeAt(j) === 0x20 /* space */) {
			j++;
		}
		if (j < value.length && isControlOrLineSeparator(value.charCodeAt(j))) {
			while (
				j < value.length &&
				isControlOrLineSeparator(value.charCodeAt(j))
			) {
				j++;
			}
			while (j < value.length && value.charCodeAt(j) === 0x20) {
				j++;
			}
			out += " ";
			i = j;
			continue;
		}
		// No control char after the space run: nothing here can start a match,
		// so copy [i, j] verbatim (run + the non-matching char) and move on.
		out += value.slice(i, Math.min(j + 1, value.length));
		i = j + 1;
	}
	return out;
}

/**
 * Linear trailing trim; the equivalent regexes backtrack quadratically on long
 * interior runs of the trimmed characters.
 */
function trimTrailingCharsLinear(value: string, chars: string): string {
	let end = value.length;
	while (end > 0 && chars.includes(value[end - 1])) end--;
	return value.slice(0, end);
}

/**
 * Characters Obsidian itself refuses in a path segment, measured against
 * `vault.create`/`createFolder` on Obsidian 1.13.0: only `:`. `\` and `/` are
 * separators, and `* ? " < > | ^ [ ] #` create fine on macOS/Linux, so they are
 * not rejected. Control characters are already collapsed by the normalizer.
 */
const OBSIDIAN_ILLEGAL_PATH_CHARS = [":"] as const;

/**
 * The characters in `path` that Obsidian will refuse, in the order listed above.
 *
 * A plain `includes` scan per character: no regex, because every path here
 * embeds untrusted format output ({{VALUE}}, clipboard, an included template
 * body) and this runs on every keystroke of a preview.
 */
export function findIllegalFilePathChars(path: string): string[] {
	return OBSIDIAN_ILLEGAL_PATH_CHARS.filter((char) => path.includes(char));
}

/**
 * One sentence naming both sources of the character: every argument-bearing
 * token has a colon in its own syntax, so the format string cannot reliably be
 * blamed. The rule comes first so the preview's three-line clamp never cuts it.
 */
export function describeIllegalFilePathChars(chars: readonly string[]): string {
	return `A file or folder name cannot contain ${quoteChars(chars)}, so this choice would fail at run time. ${CHECK_YOUR_TOKENS}`;
}

/**
 * The same finding at run time, with the concrete path. Shares the character
 * set and hint with the preview's sentence.
 */
export function describeIllegalFilePathCharsForRun(
	chars: readonly string[],
	path: string,
): string {
	return `Cannot create "${path}": a file or folder name cannot contain ${quoteChars(chars)}. ${CHECK_YOUR_TOKENS}`;
}

const CHECK_YOUR_TOKENS =
	"Check your own text and tokens like {{TIME}}, which is HH:mm.";

function quoteChars(chars: readonly string[]): string {
	return chars.map((char) => `"${char}"`).join(", ");
}

/**
 * The normalized path plus the reasons the strict entry point would have
 * rejected it. See {@link previewGeneratedFilePath}.
 */
type GeneratedFilePathPreview = {
	path: string;
	problems: string[];
};

export function normalizeGeneratedFilePath(
	path: string,
	label = "File path",
): string {
	const { path: normalized, problems } = normalizeGeneratedFilePathCore(
		path,
		label,
	);
	// Problems are collected left to right; the first is the one to raise.
	if (problems.length > 0) throw new Error(problems[0]);
	return normalized;
}

/**
 * What {@link normalizeGeneratedFilePath} would make of the path, without
 * throwing, for the file-name preview. The run normalizes every generated name,
 * so a preview that skipped it would claim names the run never creates.
 * Rejections come back as `problems`.
 */
export function previewGeneratedFilePath(
	path: string,
	label = "File path",
): GeneratedFilePathPreview {
	return normalizeGeneratedFilePathCore(path, label);
}

function normalizeGeneratedFilePathCore(
	path: string,
	label: string,
): GeneratedFilePathPreview {
	const problems: string[] = [];
	// Backslash is a separator before the "."/".." check: Obsidian's normalizePath
	// converts it, so "..\\..\\evil" would otherwise pass as one segment yet be
	// written as a traversal. escapesVaultBoundary at the create sink is the
	// authoritative boundary for absolute paths.
	const segments = path.replace(/\\/g, "/").split("/");
	const normalized = segments.map((segment, index) => {
		if (
			segment.length === 0
			&& index !== 0
			&& index !== segments.length - 1
		) {
			problems.push(
				`${label} contains an empty path segment after formatting.`,
			);
			return segment;
		}

		return normalizeGeneratedFilePathSegment(segment, label, problems);
	});

	return { path: normalized.join("/"), problems };
}

function normalizeGeneratedFilePathSegment(
	segment: string,
	label: string,
	problems: string[],
): string {
	if (segment.length === 0) return segment;

	const startsWithControl =
		STARTS_WITH_CONTROL_OR_LINE_SEPARATOR.test(segment);
	const endsWithControl = ENDS_WITH_CONTROL_OR_LINE_SEPARATOR.test(segment);
	let normalized = collapseControlRunsWithSpaces(segment);

	if (startsWithControl) normalized = normalized.replace(/^ /u, "");
	if (endsWithControl) normalized = normalized.replace(/ $/u, "");

	const withoutTrailingSpaces = trimTrailingCharsLinear(normalized, " ");
	if (withoutTrailingSpaces === "." || withoutTrailingSpaces === "..") {
		problems.push(`${label} cannot contain "." or ".." path segments.`);
		return withoutTrailingSpaces;
	}

	normalized = trimTrailingCharsLinear(normalized, ". ");

	if (!normalized) {
		problems.push(`${label} contains an empty path segment after formatting.`);
	}

	return normalized;
}
