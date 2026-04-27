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
	if (options.length === 0) return starting;
	if (starting !== "") return starting;
	return options[0] ?? "";
}
