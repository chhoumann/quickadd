import { isReservedVariableKey } from "../../utils/reservedVariableKeys";

/**
 * Guard for the `assignToVariable` option shared by ai.agent and ai.prompt/chunkedPrompt (#714).
 * Rejects names that the formatter treats specially (so they cannot be hijacked),
 * that are reserved for QuickAdd internal plumbing, or that are unreachable by the
 * {{VALUE:name}} grammar.
 */
export function assertAssignableVariableName(name: string): void {
	const trimmed = name.trim();
	if (!trimmed) throw new Error("assignToVariable cannot be empty.");
	// `value` (the programmatic {{VALUE}} slot) and `title` (file-name title) are
	// formatter-reserved; assigning them would silently hijack those tokens.
	if (new Set(["value", "title", "text", "meta"]).has(trimmed)) {
		throw new Error(
			`assignToVariable "${trimmed}" is reserved (it would hijack a built-in formatter token).`,
		);
	}
	if (trimmed.endsWith("-quoted")) {
		throw new Error(
			`assignToVariable "${trimmed}" cannot end with "-quoted" (collides with the quoted output variable).`,
		);
	}
	// Reserved internal namespace (shared with the URI/CLI boundaries) and the
	// pipe/comma characters the {{VALUE:name}} grammar cannot reference.
	if (isReservedVariableKey(trimmed)) {
		throw new Error(
			`assignToVariable "${trimmed}" uses the reserved "__qa." prefix for QuickAdd internal variables.`,
		);
	}
	if (/[|,]/.test(trimmed)) {
		throw new Error(
			`assignToVariable "${trimmed}" contains characters unreachable by {{VALUE:name}}.`,
		);
	}
}
