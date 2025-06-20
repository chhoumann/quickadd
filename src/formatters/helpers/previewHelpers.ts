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
		const month = (date.getMonth() + 1).toString().padStart(2, '0');
		const day = date.getDate().toString().padStart(2, '0');
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		const seconds = date.getSeconds().toString().padStart(2, '0');
		
		// Handle common format patterns - order matters for longer patterns first!
		return format
			// Year patterns
			.replace(/YYYY/g, year.toString())
			.replace(/YY/g, year.toString().slice(-2))
			// Month patterns  
			.replace(/MMMM/g, this.MONTH_NAMES[date.getMonth()])
			.replace(/MMM/g, this.MONTH_NAMES_SHORT[date.getMonth()])
			.replace(/MM/g, month)
			.replace(/M/g, (date.getMonth() + 1).toString())
			// Day patterns
			.replace(/dddd/g, this.DAY_NAMES[date.getDay()])
			.replace(/ddd/g, this.DAY_NAMES_SHORT[date.getDay()])
			.replace(/DD/g, day)
			.replace(/D/g, date.getDate().toString())
			// Time patterns
			.replace(/HH/g, hours)
			.replace(/H/g, date.getHours().toString())
			.replace(/mm/g, minutes)
			.replace(/m/g, date.getMinutes().toString())
			.replace(/ss/g, seconds)
			.replace(/s/g, date.getSeconds().toString())
			// Week patterns
			.replace(/ww/g, this.getWeekNumber(date).toString().padStart(2, '0'))
			.replace(/w/g, this.getWeekNumber(date).toString());
	}

	private static getWeekNumber(date: Date): number {
		const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
		const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
		return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
	}
}
