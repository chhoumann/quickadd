export function mapMappedSuggesterValue(
	rawInput: string,
	displayToValue: Map<string, string>,
	fromCompletion: boolean,
): string {
	if (!fromCompletion) return rawInput;
	return displayToValue.get(rawInput) ?? rawInput;
}
