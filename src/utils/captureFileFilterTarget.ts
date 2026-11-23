import { parseFilterSegments, type FieldFilter } from "./FieldSuggestionParser";
import { hasFileFilter } from "./FieldSuggestionFileFilter";
import { parsePipeKeyValue, splitPipeParts } from "./pipeSyntax";

interface CaptureFileFilterTarget {
	filter: FieldFilter;
	multiSelect: boolean;
}

const FILTER_KEYS = new Set([
	"folder",
	"tag",
	"exclude-folder",
	"exclude-tag",
	"exclude-file",
]);

function mergeTags(first: string | undefined, rest: string[] | undefined): string[] | undefined {
	const tags = [first, ...(rest ?? [])]
		.filter((tag): tag is string => typeof tag === "string")
		.map((tag) => tag.trim())
		.filter(Boolean);
	return tags.length > 0 ? tags : undefined;
}

function parsePipeFilters(input: string): CaptureFileFilterTarget {
	const parsed = parseFilterSegments(splitPipeParts(input), { token: input });
	return {
		filter: parsed.filters,
		multiSelect: parsed.multiSelect ?? false,
	};
}

/**
 * Parses Capture "Capture to" file-filter targets:
 *
 * - `#work|tag:project`
 * - `tag:work|tag:project`
 * - `folder:Goals|folder:Projects|tag:active`
 *
 * `property:` targets are intentionally parsed elsewhere before this helper.
 */
export function parseCaptureFileFilterTarget(
	raw: string,
): CaptureFileFilterTarget | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith("#")) {
		const parts = splitPipeParts(trimmed);
		const tag = (parts.shift() ?? "")
			.replace(/^#/, "")
			.replace(/\.md$/i, "")
			.trim();
		if (!tag) return null;

		const parsed = parts.length > 0
			? parsePipeFilters(parts.join("|"))
			: { filter: {}, multiSelect: false };
		return {
			filter: {
				...parsed.filter,
				tags: mergeTags(tag, parsed.filter.tags),
			},
			multiSelect: parsed.multiSelect,
		};
	}

	const firstPart = splitPipeParts(trimmed)[0] ?? "";
	const parsedFirstPart = parsePipeKeyValue(firstPart);
	if (!parsedFirstPart || !FILTER_KEYS.has(parsedFirstPart.key)) {
		return null;
	}

	const parsed = parsePipeFilters(trimmed);
	return hasFileFilter(parsed.filter) ? parsed : null;
}
