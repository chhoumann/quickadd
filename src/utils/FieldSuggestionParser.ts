import { log } from "../logger/logManager";
import {
	parseBooleanFlag,
	parsePipeKeyValue,
	splitPipeParts,
} from "./pipeSyntax";

export interface FieldFilter {
	/**
	 * Legacy single-folder include. Kept for compatibility with existing callers.
	 * New code should read both this and `folders`; repeated `folder:` filters
	 * populate `folders` and mean "any of these folders".
	 */
	folder?: string;
	folders?: string[];
	tags?: string[];
	inline?: boolean;
	inlineCodeBlocks?: string[];
	defaultValue?: string;
	defaultEmpty?: boolean;
	defaultAlways?: boolean;
	caseSensitive?: boolean;
	excludeFolders?: string[];
	excludeTags?: string[];
	excludeFiles?: string[];
}

export class FieldSuggestionParser {
	/**
	 * Parses the field suggestion syntax to extract field name and filters
	 * Examples:
	 * - "fieldname" -> { fieldName: "fieldname", filters: {} }
	 * - "fieldname|folder:daily" -> { fieldName: "fieldname", filters: { folder: "daily" } }
	 * - "fieldname|folder:daily|tag:work|tag:project" -> { fieldName: "fieldname", filters: { folder: "daily", tags: ["work", "project"] } }
	 */
	static parse(
		input: string,
		options?: { warnUnknown?: boolean },
	): {
		fieldName: string;
		filters: FieldFilter;
		multiSelect?: boolean;
	} {
		const parts = splitPipeParts(input).map((p) => p.trim());
		const fieldName = parts[0];
		const filters: FieldFilter = {};
		let multiSelect = false;

		for (let i = 1; i < parts.length; i++) {
			const filterPart = parts[i];
			if (filterPart.toLowerCase() === "multi") {
				multiSelect = true;
				continue;
			}

			const parsed = parsePipeKeyValue(filterPart);
			if (!parsed) continue; // Skip invalid filter format

			const filterType = parsed.key;
			const filterValue = parsed.value;

			switch (filterType) {
				case "multi":
					multiSelect = parseBooleanFlag(filterValue);
					break;
				case "folder":
					if (!filters.folders) {
						filters.folders = [];
					}
					filters.folders.push(filterValue);
					if (!filters.folder) {
						filters.folder = filterValue;
					}
					break;
				case "tag": {
					if (!filters.tags) {
						filters.tags = [];
					}
					// Remove # prefix if present
					const tagName = filterValue.startsWith("#")
						? filterValue.substring(1)
						: filterValue;
					filters.tags.push(tagName);
					break;
				}
				case "inline":
					filters.inline = filterValue.toLowerCase() === "true";
					break;
				case "inline-code-blocks":
					if (!filters.inlineCodeBlocks) {
						filters.inlineCodeBlocks = [];
					}
					filters.inlineCodeBlocks.push(
						...filterValue
							.split(",")
							.map((value) => value.trim().toLowerCase())
							.filter((value) => value.length > 0),
					);
					break;
				case "default":
					filters.defaultValue = filterValue;
					break;
				case "default-empty":
					filters.defaultEmpty = filterValue.toLowerCase() === "true";
					break;
				case "default-always":
					filters.defaultAlways = filterValue.toLowerCase() === "true";
					break;
				case "case-sensitive":
					filters.caseSensitive = filterValue.toLowerCase() === "true";
					break;
				case "exclude-folder":
					if (!filters.excludeFolders) {
						filters.excludeFolders = [];
					}
					filters.excludeFolders.push(filterValue);
					break;
				case "exclude-tag": {
					if (!filters.excludeTags) {
						filters.excludeTags = [];
					}
					// Remove # prefix if present
					const excludeTagName = filterValue.startsWith("#")
						? filterValue.substring(1)
						: filterValue;
					filters.excludeTags.push(excludeTagName);
					break;
				}
				case "exclude-file":
					if (!filters.excludeFiles) {
						filters.excludeFiles = [];
					}
					filters.excludeFiles.push(filterValue);
					break;
				default:
					// An unrecognized pipe key (typically a typo like
					// `exclud-tag` or `fodler`) would otherwise be dropped
					// silently, leaving the user with unfiltered suggestions and
					// no indication the filter did nothing. Surface a warning so
					// the mistake is discoverable — but ONLY for the {{FIELD}}
					// grammar (warnUnknown). This parser is also shared by the
					// {{FILE:...|label:/name:}}, property:, and capture-scope
					// grammars, which legitimately carry keys this switch does
					// not know and peel off elsewhere; warning there would emit
					// false "Unknown FIELD filter" notices and leak internal
					// sentinels like __capture_scope.
					if (options?.warnUnknown) {
						log.logWarning(
							`Unknown FIELD filter "${filterType}" in "{{FIELD:${input}}}" was ignored. Supported filters: folder, tag, inline, inline-code-blocks, exclude-folder, exclude-tag, exclude-file, default, default-empty, default-always, case-sensitive, multi.`,
						);
					}
					break;
			}
		}

		return multiSelect
			? { fieldName, filters, multiSelect }
			: { fieldName, filters };
	}
}
