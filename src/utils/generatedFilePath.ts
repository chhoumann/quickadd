const CONTROL_OR_LINE_SEPARATOR_CHARS = `${String.fromCharCode(0x00)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}\u2028\u2029`;
const CONTROL_OR_LINE_SEPARATOR_WITH_SPACES = new RegExp(
	` *[${CONTROL_OR_LINE_SEPARATOR_CHARS}]+ *`,
	"gu",
);
const STARTS_WITH_CONTROL_OR_LINE_SEPARATOR = new RegExp(
	`^ *[${CONTROL_OR_LINE_SEPARATOR_CHARS}]`,
	"u",
);
const ENDS_WITH_CONTROL_OR_LINE_SEPARATOR = new RegExp(
	`[${CONTROL_OR_LINE_SEPARATOR_CHARS}] *$`,
	"u",
);

export function normalizeGeneratedFilePath(
	path: string,
	label = "File path",
): string {
	return path
		.split("/")
		.map((segment) => normalizeGeneratedFilePathSegment(segment, label))
		.join("/");
}

function normalizeGeneratedFilePathSegment(
	segment: string,
	label: string,
): string {
	if (segment.length === 0) return segment;

	const startsWithControl =
		STARTS_WITH_CONTROL_OR_LINE_SEPARATOR.test(segment);
	const endsWithControl = ENDS_WITH_CONTROL_OR_LINE_SEPARATOR.test(segment);
	let normalized = segment.replace(CONTROL_OR_LINE_SEPARATOR_WITH_SPACES, " ");

	if (startsWithControl) normalized = normalized.replace(/^ /u, "");
	if (endsWithControl) normalized = normalized.replace(/ $/u, "");

	const withoutTrailingSpaces = normalized.replace(/ +$/u, "");
	if (withoutTrailingSpaces === "." || withoutTrailingSpaces === "..") {
		throw new Error(`${label} cannot contain "." or ".." path segments.`);
	}

	normalized = normalized.replace(/[. ]+$/u, "");

	if (!normalized) {
		throw new Error(`${label} contains an empty path segment after formatting.`);
	}

	return normalized;
}
