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

// Linear replacement for the historical global regex
// ` *[<control>]+ *` -> " ": each run of control/line-separator characters,
// together with the spaces directly around it, collapses to a single space.
// The regex backtracked quadratically on a long interior space run with no
// control character after it (each start position re-scanned the run), and
// these names embed untrusted format output ({{VALUE}}/clipboard). When the
// space run is not followed by a control character the regex left it
// untouched, so the scanner copies it verbatim and jumps past it.
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
 * Linear trailing-trim for a small character set. The historical
 * `/ +$/u` / `/[. ]+$/u` replaces backtracked quadratically on a long
 * interior run of the trimmed characters ("a" + ".".repeat(n) + "b").
 */
function trimTrailingCharsLinear(value: string, chars: string): string {
	let end = value.length;
	while (end > 0 && chars.includes(value[end - 1])) end--;
	return value.slice(0, end);
}

/**
 * The normalized path plus the reasons the strict entry point would have
 * rejected it. See {@link previewGeneratedFilePath}.
 */
export type GeneratedFilePathPreview = {
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
	// Problems are collected left to right, so the first one is the one the
	// historical throw-on-sight implementation would have raised.
	if (problems.length > 0) throw new Error(problems[0]);
	return normalized;
}

/**
 * What {@link normalizeGeneratedFilePath} would make of this path, without
 * throwing - for the file-name PREVIEW, which is a speculative evaluation of
 * incomplete input and must never throw its way out of a keystroke (#1558).
 *
 * The preview needs this because the run applies the normalizer to every
 * generated name (TemplateChoiceEngine, TemplateInsertEngine,
 * templateNoteDiscovery, and the capture target via captureTargetResolution),
 * so it is the last thing standing between the formatted string and the file
 * that appears in the vault. Without it a preview showing `Daily/Note.` or a
 * multi-line `{{TEMPLATE:}}` body claims a name the run will never create
 * (#1563). The rejections come back as `problems` instead of an exception, so
 * the preview can show the best-effort name AND say that the run would abort.
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
	// Treat a backslash as a path separator BEFORE the per-segment "." / ".."
	// rejection below. Obsidian's own `normalizePath` converts "\\" -> "/" before
	// any path is touched on disk, so a formatted name like "..\\..\\..\\evil"
	// would otherwise survive this guard as ONE non-".." segment yet still be
	// written by `vault.create` as the traversal "../../../evil" — an out-of-vault
	// write. Converting here makes the guard see the real segments (so "..\\" is
	// rejected) and keeps this normalizer's view of the path identical to what
	// Obsidian writes. The vault-containment assertion at the create sink
	// (createFileWithInput -> escapesVaultBoundary) is the authoritative boundary
	// for absolute / drive / UNC paths.
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
