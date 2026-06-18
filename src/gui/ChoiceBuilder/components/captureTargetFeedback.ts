import type { FieldFilter } from "../../../utils/FieldSuggestionParser";
import { parseCaptureFileFilterTarget } from "../../../utils/captureFileFilterTarget";
import { parsePropertyTarget } from "../../../utils/propertyTarget";

export type CaptureTargetFeedback = {
	recognized: true;
	valid: boolean;
	variant: "success" | "error";
	message: string;
};

function normalizeCaptureTarget(raw: string): string {
	return raw.trim().replace(/^\/+/, "");
}

function compact(values: readonly string[] | undefined): string[] {
	return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function formatList(values: readonly string[], finalJoiner = "or"): string {
	if (values.length <= 1) return values[0] ?? "";
	if (finalJoiner === "+") return values.join(" + ");
	if (values.length === 2) return `${values[0]} ${finalJoiner} ${values[1]}`;
	return `${values.slice(0, -1).join(", ")}, ${finalJoiner} ${values[values.length - 1]}`;
}

function summarizeFilter(filter: FieldFilter): string {
	const folders = compact(filter.folders ?? (filter.folder ? [filter.folder] : []));
	const tags = compact(filter.tags);
	const excludedFolders = compact(filter.excludeFolders);
	const excludedTags = compact(filter.excludeTags);
	const excludedFiles = compact(filter.excludeFiles);
	const parts: string[] = [];

	if (folders.length > 0) {
		parts.push(
			`${folders.length === 1 ? "folder" : "folders"} ${formatList(folders)}`,
		);
	}
	if (tags.length > 0) {
		parts.push(`${tags.length === 1 ? "tag" : "tags"} ${formatList(tags, "+")}`);
	}
	if (excludedFolders.length > 0) {
		parts.push(
			`excluding ${excludedFolders.length === 1 ? "folder" : "folders"} ${formatList(excludedFolders)}`,
		);
	}
	if (excludedTags.length > 0) {
		parts.push(
			`excluding ${excludedTags.length === 1 ? "tag" : "tags"} ${formatList(excludedTags, "+")}`,
		);
	}
	if (excludedFiles.length > 0) {
		parts.push(
			`excluding ${excludedFiles.length === 1 ? "file" : "files"} ${formatList(excludedFiles)}`,
		);
	}

	return parts.length > 0 ? parts.join("; ") : "all notes";
}

export function getCaptureTargetFeedback(
	raw: string,
): CaptureTargetFeedback | null {
	const normalized = normalizeCaptureTarget(raw);
	const propertyTarget = parsePropertyTarget(normalized);
	if (propertyTarget) {
		if (!propertyTarget.field) {
			return {
				recognized: true,
				valid: false,
				variant: "error",
				message:
					"Property capture target needs a field name, e.g. property:type=draft.",
			};
		}

		const propertySummary = propertyTarget.value
			? `frontmatter ${propertyTarget.field} = ${propertyTarget.value}`
			: `frontmatter field ${propertyTarget.field}`;
		const filterSummary = summarizeFilter(propertyTarget.filter);
		const suffix = filterSummary === "all notes" ? "" : `; ${filterSummary}`;

		return {
			recognized: true,
			valid: true,
			variant: "success",
			message: `Recognized property target: ${propertySummary}${suffix}.`,
		};
	}

	const fileFilterTarget = parseCaptureFileFilterTarget(normalized);
	if (!fileFilterTarget) return null;

	if (fileFilterTarget.multiSelect) {
		return {
			recognized: true,
			valid: false,
			variant: "error",
			message:
				"Capture target filters select one destination file. Use {{FILE:...|multi}} in the capture format for multi-value metadata.",
		};
	}

	return {
		recognized: true,
		valid: true,
		variant: "success",
		message: `Recognized filtered picker: ${summarizeFilter(fileFilterTarget.filter)}.`,
	};
}
