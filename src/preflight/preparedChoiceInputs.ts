import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type { TemplateNoteSelection } from "src/utils/templateNoteDiscovery";

export interface PreparedChoiceInputs {
	choiceId: string;
	values: ReadonlyMap<string, unknown>;
	discovery: TemplateNoteSelection | null;
}

interface PreparedInputState {
	pending: Map<string, PreparedChoiceInputs>;
	active: PreparedChoiceInputs | null;
	discoveryMacros: Set<string>;
}

const states = new WeakMap<IChoiceExecutor, PreparedInputState>();

function stateFor(executor: IChoiceExecutor): PreparedInputState {
	let state = states.get(executor);
	if (!state) {
		state = { pending: new Map(), active: null, discoveryMacros: new Set() };
		states.set(executor, state);
	}
	return state;
}

export function markDiscoveryMacro(executor: IChoiceExecutor, macroId: string): void {
	stateFor(executor).discoveryMacros.add(macroId);
}

export function isDiscoveryMacro(executor: IChoiceExecutor, macroId: string): boolean {
	return states.get(executor)?.discoveryMacros.has(macroId) ?? false;
}

export function setPreparedChoiceInputs(
	executor: IChoiceExecutor,
	occurrenceId: string,
	inputs: PreparedChoiceInputs,
): void {
	const state = stateFor(executor);
	state.pending.set(occurrenceId, inputs);
}

export function hasActivePreparedChoiceInputs(
	executor: IChoiceExecutor,
	choiceId: string,
): boolean {
	return states.get(executor)?.active?.choiceId === choiceId;
}

export function getPreparedTemplateNoteSelection(
	executor: IChoiceExecutor,
	choiceId: string,
): TemplateNoteSelection | null {
	const active = states.get(executor)?.active;
	return active?.choiceId === choiceId ? active.discovery : null;
}

export function clearPreparedChoiceInputs(executor: IChoiceExecutor): void {
	states.delete(executor);
}

export async function withPreparedChoiceInputs<T>(
	executor: IChoiceExecutor,
	occurrenceId: string,
	callback: () => Promise<T>,
): Promise<T> {
	const state = states.get(executor);
	const inputs = state?.pending.get(occurrenceId);
	if (!state || !inputs) return callback();
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
