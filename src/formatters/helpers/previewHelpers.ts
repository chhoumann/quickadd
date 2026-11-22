import { findIllegalFilePathChars } from "../../utils/generatedFilePath";

const VARIABLE_EXAMPLES: Record<string, string> = {
	"title": "My Document Title",
	"name": "Document Name", 
	"project": "Project Alpha",
	"category": "Notes",
	"author": "Your Name",
	"status": "Draft",
	"priority": "High",
	"tag": "important",
	"type": "meeting",
	"client": "Acme Corp"
};

const MACRO_DESCRIPTIONS: Record<string, string> = {
	"clipboard": "clipboard_content",
	"date": "formatted_date",
	"time": "current_time",
	"random": "random_value",
	"uuid": "unique_id"
};

const VARIABLE_PATTERNS: Array<{pattern: RegExp, example: string}> = [
	{pattern: /date|time/i, example: "2024-01-15"},
	{pattern: /title|name/i, example: "Example Title"},
	{pattern: /tag/i, example: "important"},
	{pattern: /category|type/i, example: "Notes"},
	{pattern: /author|user/i, example: "Your Name"},
	{pattern: /project/i, example: "Project Alpha"},
	{pattern: /status/i, example: "In Progress"},
	{pattern: /priority/i, example: "High"},
	{pattern: /number|count|id/i, example: "001"}
];

export function getVariableExample(variableName: string): string {
	const lowerName = variableName.toLowerCase();
	const predefinedExample = VARIABLE_EXAMPLES[lowerName];
	
	if (predefinedExample) {
		return predefinedExample;
	}
	
	return `${variableName}_example`;
}

export function getMacroPreview(macroName: string): string {
	const description = MACRO_DESCRIPTIONS[macroName.toLowerCase()] || `${macroName}_output`;
	return description;
}

export function getVariablePromptExample(variableName: string): string {
	for (const {pattern, example} of VARIABLE_PATTERNS) {
		if (pattern.test(variableName)) {
			return example;
		}
	}
	
	return `${variableName}_value`;
}

export function getSuggestionPreview(suggestedValues: string[]): string {
	if (suggestedValues.length > 0) {
		return `${suggestedValues[0]} (${suggestedValues.length} options)`;
	}
	return "suggestion_list";
}

/**
 * A file-name stand-in, or `neutral` when it could not be a name. Stand-ins echo
 * a prompt header or macro name, which never becomes part of the name at run
 * time, so their illegal characters would be the preview's own invention.
 */
export function fileNameSafeStandIn(standIn: string, neutral: string): string {
	return findIllegalFilePathChars(standIn).length > 0 ? neutral : standIn;
}

/**
 * Stand-in for `{{FIELD:...}}`, named after the field rather than the whole
 * specifier with its filters. A placeholder rather than a vault value, since
 * FIELD prompts at run time. Neutral when the specifier starts with a pipe.
 */
export function fieldValuePreview(parsed: { fieldName: string }): string {
	const fieldName = parsed.fieldName.trim();
	return fieldName ? `${fieldName}_field_value` : "field_value";
}

export function getCurrentFileLinkPreview(activeFile?: {basename: string, path: string} | null): string {
	return activeFile?.path ? activeFile.basename : "current_file";
}

/** {{linksection}} preview; the real expansion links to the heading under the cursor. */
export function getCurrentFileLinkToSectionPreview(activeFile?: {basename: string, path: string} | null): string {
	return `${activeFile?.path ? activeFile.basename : "current_file"}#Section`;
}

export function getCurrentFileNamePreview(activeFile?: {basename: string} | null): string {
	return activeFile?.basename || "current_filename";
}

/**
 * Obsidian's root folder has path "/", which the runtime resolver collapses to
 * "". Never null, so the preview cannot hit the missing-active-file throw.
 */
export function getCurrentFolderPathPreview(
	activeFile?: { parent?: { path: string } | null } | null,
): string {
	if (!activeFile) return "current_folder";
	const parentPath = activeFile.parent?.path ?? "";
	return parentPath === "/" ? "" : parentPath;
}

export class DateFormatPreviewGenerator {
	private static readonly MONTH_NAMES = [
		'January', 'February', 'March', 'April', 'May', 'June', 
		'July', 'August', 'September', 'October', 'November', 'December'
	];
	
	private static readonly MONTH_NAMES_SHORT = [
		'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
		'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
	];
	
	private static readonly DAY_NAMES = [
		'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
	];
	
	private static readonly DAY_NAMES_SHORT = [
		'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'
	];

	static generate(format: string, date: Date = new Date()): string {
		const year = date.getFullYear();
		const week = this.getWeekNumber(date);
		const dayOfMonth = date.getDate();

		// Longest-first within each leading character, scanned once into a separate
		// buffer, so a substituted name like "March" is never re-scanned by a later
		// single-letter token.
		const tokens: Array<[string, string]> = [
			['YYYY', year.toString()],
			['YY', year.toString().slice(-2)],
			['MMMM', this.MONTH_NAMES[date.getMonth()]],
			['MMM', this.MONTH_NAMES_SHORT[date.getMonth()]],
			['MM', (date.getMonth() + 1).toString().padStart(2, '0')],
			['M', (date.getMonth() + 1).toString()],
			['dddd', this.DAY_NAMES[date.getDay()]],
			['ddd', this.DAY_NAMES_SHORT[date.getDay()]],
			['Do', `${dayOfMonth}${this.ordinalSuffix(dayOfMonth)}`],
			['DD', date.getDate().toString().padStart(2, '0')],
			['D', dayOfMonth.toString()],
			['HH', date.getHours().toString().padStart(2, '0')],
			['H', date.getHours().toString()],
			['mm', date.getMinutes().toString().padStart(2, '0')],
			['m', date.getMinutes().toString()],
			['ss', date.getSeconds().toString().padStart(2, '0')],
			['s', date.getSeconds().toString()],
			['ww', week.toString().padStart(2, '0')],
			['w', week.toString()],
		];

		let result = '';
		let i = 0;
		while (i < format.length) {
			let matched = false;
			for (const [token, value] of tokens) {
				if (format.startsWith(token, i)) {
					result += value;
					i += token.length;
					matched = true;
					break;
				}
			}
			if (!matched) {
				result += format[i];
				i += 1;
			}
		}
		return result;
	}

	private static ordinalSuffix(day: number): string {
		const remainder100 = day % 100;
		if (remainder100 >= 11 && remainder100 <= 13) return 'th';
		switch (day % 10) {
			case 1: return 'st';
			case 2: return 'nd';
			case 3: return 'rd';
			default: return 'th';
		}
	}

	private static getWeekNumber(date: Date): number {
		const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
		const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
		return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
	}
}
