export type ParsedMacroToken = {
	macroName: string;
	label?: string;
};

export function parseMacroToken(raw: string): ParsedMacroToken | null {
	if (!raw) return null;
	const pipeIndex = raw.indexOf("|");
	if (pipeIndex === -1) {
		const macroName = raw.trim();
		return macroName ? { macroName } : null;
	}

	const macroName = raw.slice(0, pipeIndex).trim();
	if (!macroName) return null;

	const labelPart = raw.slice(pipeIndex + 1).trim();
	if (!labelPart) return { macroName };
	if (!labelPart.toLowerCase().startsWith("label:")) return null;
	const label = labelPart.slice("label:".length).trim();

	return {
		macroName,
		label: label || undefined,
	};
}
