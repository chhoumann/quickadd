export function mapMappedSuggesterValue(
	rawInput: string,
	displayToValue: Map<string, string>,
	fromCompletion: boolean,
): string {
	if (!fromCompletion) return rawInput;
	return displayToValue.get(rawInput) ?? rawInput;
}

export function resolveDropdownInitialValue(
	starting: string,
	options: string[],
): string {
	// Dropdown values are stored as raw options; normalize stale values so
	// submitted state always matches a selectable dropdown option.
	if (options.length === 0) return starting;
	if (starting === "") return options[0] ?? "";
	if (options.includes(starting)) return starting;
	return options[0] ?? "";
}
