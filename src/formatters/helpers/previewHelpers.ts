/**
 * Shared utilities for generating realistic preview examples in display formatters
 */

/** Common variable examples for consistent previews across formatters */
export const VARIABLE_EXAMPLES: Record<string, string> = {
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

/** Macro descriptions for better preview understanding */
export const MACRO_DESCRIPTIONS: Record<string, string> = {
	"clipboard": "clipboard_content",
	"date": "formatted_date",
	"time": "current_time",
	"random": "random_value",
	"uuid": "unique_id"
};

/** Variable name patterns with their example values */
export const VARIABLE_PATTERNS: Array<{pattern: RegExp, example: string}> = [
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

/**
 * Gets an example value for a variable name based on common patterns
 */
export function getVariableExample(variableName: string): string {
	const lowerName = variableName.toLowerCase();
	const predefinedExample = VARIABLE_EXAMPLES[lowerName];
	
	if (predefinedExample) {
		return predefinedExample;
	}
	
	return `${variableName}_example`;
}

/**
 * Gets a descriptive macro preview
 */
export function getMacroPreview(macroName: string): string {
	const description = MACRO_DESCRIPTIONS[macroName.toLowerCase()] || `${macroName}_output`;
	return description;
}

/**
 * Gets a realistic variable prompt example based on variable name patterns
 */
export function getVariablePromptExample(variableName: string): string {
	for (const {pattern, example} of VARIABLE_PATTERNS) {
		if (pattern.test(variableName)) {
			return example;
		}
	}
	
	return `${variableName}_value`;
}

/**
 * Gets a formatted suggestion preview
 */
export function getSuggestionPreview(suggestedValues: string[]): string {
	if (suggestedValues.length > 0) {
		return `${suggestedValues[0]} (${suggestedValues.length} options)`;
	}
	return "suggestion_list";
}

/**
 * Gets a current file link preview
 */
export function getCurrentFileLinkPreview(activeFile?: {basename: string, path: string} | null): string {
	return activeFile?.path ? activeFile.basename : "current_file";
}

/**
 * Gets a current file section-link preview ({{linksection}}). Mirrors
 * getCurrentFileLinkPreview's simplified style (no [[ ]]); the real expansion is
 * a link to the heading the cursor is under.
 */
export function getCurrentFileLinkToSectionPreview(activeFile?: {basename: string, path: string} | null): string {
	return `${activeFile?.path ? activeFile.basename : "current_file"}#Section`;
}

/**
 * Gets a current filename preview
 */
export function getCurrentFileNamePreview(activeFile?: {basename: string} | null): string {
	return activeFile?.basename || "current_filename";
}

/**
 * Gets a {{foldercurrent}} preview: the active file's folder path. Obsidian's
 * root TFolder has path "/", which the runtime resolver collapses to "" - the
 * preview shows the same truthful empty string. Never null, so the preview
 * pass can never hit the runtime's missing-active-file throw.
 */
export function getCurrentFolderPathPreview(
	activeFile?: { parent?: { path: string } | null } | null,
): string {
	if (!activeFile) return "current_folder";
	const parentPath = activeFile.parent?.path ?? "";
	return parentPath === "/" ? "" : parentPath;
}

/**
 * Enhanced date format preview generator with comprehensive pattern support
 */
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

	/**
	 * Generates a preview of how the date format will look
	 */
	static generate(format: string, date: Date = new Date()): string {
		const year = date.getFullYear();
		const week = this.getWeekNumber(date);

		// Token -> replacement value, ordered longest-first WITHIN each leading
		// character so a single left-to-right scan always consumes the longest
		// matching token at each position. The previous implementation chained
		// `.replace()` calls, which re-scanned already-substituted text: a later
		// single-letter token (M, m, s, D, ...) would clobber letters inside a
		// spelled-out month/day name (e.g. "March" -> "3arch", "September" ->
		// "Septe<min>ber", "Thursday" -> "Thur<sec>day"). Appending matched values
		// to a separate buffer means substituted names are never re-scanned.
		const tokens: Array<[string, string]> = [
			['YYYY', year.toString()],
			['YY', year.toString().slice(-2)],
			['MMMM', this.MONTH_NAMES[date.getMonth()]],
			['MMM', this.MONTH_NAMES_SHORT[date.getMonth()]],
			['MM', (date.getMonth() + 1).toString().padStart(2, '0')],
			['M', (date.getMonth() + 1).toString()],
			['dddd', this.DAY_NAMES[date.getDay()]],
			['ddd', this.DAY_NAMES_SHORT[date.getDay()]],
			['DD', date.getDate().toString().padStart(2, '0')],
			['D', date.getDate().toString()],
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

	private static getWeekNumber(date: Date): number {
		const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
		const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
		return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
	}
}
