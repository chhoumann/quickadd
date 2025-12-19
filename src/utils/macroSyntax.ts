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
	const label = raw.slice(pipeIndex + 1).trim();
	if (!macroName) return null;

	return {
		macroName,
		label: label || undefined,
	};
}
