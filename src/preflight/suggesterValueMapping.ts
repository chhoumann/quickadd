/**
 * Each option's display label (the option itself when it has none) mapped to
 * the value it stores. A later option with the same label wins. `trimLabels`
 * matches labels that were split out of a joined answer, which loses their
 * surrounding spaces.
 */
export function optionValuesByLabel(
	options: string[],
	displayOptions: string[] = options,
	{ trimLabels = false }: { trimLabels?: boolean } = {},
): Map<string, string> {
	return new Map(options.map((value, index) => {
		const label = displayOptions[index] ?? value;
		return [trimLabels ? label.trim() : label, value];
	}));
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
