import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type { TemplateNoteSelection } from "src/utils/templateNoteDiscovery";

export interface PreparedChoiceInputs {
	choiceId: string;
	values: ReadonlyMap<string, unknown>;
	discovery: TemplateNoteSelection | null;
}

export interface PreparedChoiceInputState {
	pending: Map<string, PreparedChoiceInputs>;
	active: PreparedChoiceInputs | null;
	discoveryMacros: Set<string>;
}

export function createPreparedChoiceInputState(): PreparedChoiceInputState {
	return { pending: new Map(), active: null, discoveryMacros: new Set() };
}

export function markDiscoveryMacro(executor: IChoiceExecutor, macroId: string): void {
	executor.preparedInputs.discoveryMacros.add(macroId);
}

export function isDiscoveryMacro(executor: IChoiceExecutor, macroId: string): boolean {
	return executor.preparedInputs.discoveryMacros.has(macroId);
}

export function setPreparedChoiceInputs(
	executor: IChoiceExecutor,
	occurrenceId: string,
	inputs: PreparedChoiceInputs,
): void {
	executor.preparedInputs.pending.set(occurrenceId, inputs);
}

export function hasActivePreparedChoiceInputs(
	executor: IChoiceExecutor,
	choiceId: string,
): boolean {
	return executor.preparedInputs.active?.choiceId === choiceId;
}

export function getPreparedTemplateNoteSelection(
	executor: IChoiceExecutor,
	choiceId: string,
): TemplateNoteSelection | null {
	const active = executor.preparedInputs.active;
	return active?.choiceId === choiceId ? active.discovery : null;
}

export function clearPreparedChoiceInputs(executor: IChoiceExecutor): void {
	executor.preparedInputs.pending.clear();
	executor.preparedInputs.discoveryMacros.clear();
	executor.preparedInputs.active = null;
}

export async function withPreparedChoiceInputs<T>(
	executor: IChoiceExecutor,
	occurrenceId: string,
	callback: () => Promise<T>,
): Promise<T> {
	const state = executor.preparedInputs;
	const inputs = state.pending.get(occurrenceId);
	if (!inputs) return callback();
	state.pending.delete(occurrenceId);
	const previousActive = state.active;
	state.active = inputs;
	const hadValue = executor.variables.has("value");
	const previousValue = executor.variables.get("value");
	let temporaryValue = false;
	for (const [key, value] of inputs.values) {
		if (executor.variables.get(key) != null) continue;
		executor.variables.set(key, value);
		if (key === "value") temporaryValue = true;
	}
	try {
		return await callback();
	} finally {
		if (temporaryValue && executor.variables.get("value") === inputs.values.get("value")) {
			if (hadValue) executor.variables.set("value", previousValue);
			else executor.variables.delete("value");
		}
		state.active = previousActive;
	}
}
