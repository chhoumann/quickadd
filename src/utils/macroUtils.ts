import { isUnreadableList as isUnreadableCommandList } from "./persistedContainers";
import { v4 as uuidv4 } from "uuid";
import type { IMacro } from "../types/macros/IMacro";
import type { ICommand } from "../types/macros/ICommand";

/**
 * A non-null object can carry a command; nulls and primitives cannot.
 */
export function isCommandLike(value: unknown): value is ICommand {
	return typeof value === "object" && value !== null;
}

/**
 * Only objects can persist macro properties; JSON drops named array properties.
 */
export function isMacroObject(
	value: unknown,
): value is Record<string, unknown> {
	return isCommandLike(value) && !Array.isArray(value);
}

/**
 * Whether a non-object macro may still carry recoverable data.
 */
export function isUnreadableMacro(value: unknown): boolean {
	if (isMacroObject(value)) return false;
	if (Array.isArray(value)) return value.length > 0;
	return isUnreadableCommandList(value);
}

/**
 * Resolve both object macros and legacy array-valued macros. Return undefined
 * for empty values; preserve unreadable data for callers to detect.
 */
export function macroCommandsValueOf(macro: unknown): unknown {
	if (isMacroObject(macro)) return macro.commands;
	return isUnreadableMacro(macro) ? macro : undefined;
}

/**
 * Read view only. Write paths must guard with hasCommandList rather than
 * persisting the empty fallback over a malformed commands value.
 */
export function commandListOf(value: unknown): ICommand[] {
	return Array.isArray(value) ? value : [];
}

/**
 * Read view of the legacy macros root. Guard writes with Array.isArray to
 * preserve malformed data for recovery.
 */
export function rootMacrosOf<T = IMacro>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Whether write paths may rebuild this command list.
 */
export function hasCommandList(value: unknown): boolean {
	return Array.isArray(value);
}

/**
 * Same recoverability rule as choice lists; empty values carry no commands.
 */
export { isUnreadableList as isUnreadableCommandList } from "./persistedContainers";

export interface NormalizedCommandList {
	commands: ICommand[];
	/** False when `commands` is the input array itself, unchanged. */
	changed: boolean;
}

/**
 * Normalize at the editor seam: flatten nested arrays, discard primitives, and
 * repair missing or duplicate IDs without dropping real commands. Secret refs
 * travel in settings independently of repaired IDs. Return the original array
 * when unchanged; loading alone must not repeatedly mint IDs.
 */
export function normalizeCommandList(value: unknown): NormalizedCommandList {
	const input = commandListOf(value);
	const seen = new Set<string>();
	let changed = false;

	const commands: ICommand[] = [];
	for (const entry of input) {
		// An ARRAY entry is read as a NESTED LIST and spliced in, the same
		// recoverable reading `macroCommandsValueOf` gives an array-valued `macro`.
		// `isCommandLike([])` is true, so the alternative is spreading it into one
		// nameless, typeless row. Kept byte-symmetric with `normalizeChoiceList`.
		if (Array.isArray(entry)) {
			const inner = normalizeCommandList(entry);
			for (const command of inner.commands) {
				const id = command.id;
				if (typeof id === "string" && id !== "" && !seen.has(id)) {
					seen.add(id);
					commands.push(command);
					continue;
				}
				const replacement = { ...command, id: uuidv4() };
				seen.add(replacement.id);
				commands.push(replacement);
			}
			changed = true;
			continue;
		}
		if (!isCommandLike(entry)) {
			changed = true;
			continue;
		}
		const id = entry.id;
		if (typeof id === "string" && id !== "" && !seen.has(id)) {
			seen.add(id);
			commands.push(entry);
			continue;
		}
		const replacement = { ...entry, id: uuidv4() };
		seen.add(replacement.id);
		commands.push(replacement);
		changed = true;
	}

	return changed ? { commands, changed } : { commands: input, changed: false };
}

/**
 * Regenerate IDs throughout duplicated macro commands, branches and nested
 * choices, preserving malformed containers. Visit shared objects once because
 * structuredClone preserves shared references. Array-valued macros and nested
 * command arrays are lists, not objects on which an ID can be persisted.
 */
export function regenerateIds(macro: IMacro): void {
	regenerateMacroIds(macro, new Set<unknown>());
}

function regenerateMacroIds(macro: unknown, visited: Set<unknown>): void {
	if (!isCommandLike(macro)) return;
	if (visited.has(macro)) return;
	visited.add(macro);
	// Only a real macro OBJECT has an `id` worth minting. Writing one onto an
	// array-valued macro is a no-op JSON.stringify discards, not a repair.
	if (isMacroObject(macro)) macro.id = uuidv4();
	regenerateCommandIds(macroCommandsValueOf(macro), visited);
}

function regenerateCommandIds(commands: unknown, visited: Set<unknown>): void {
	if (!hasCommandList(commands)) return;
	for (const command of commands as ICommand[]) {
		// A nested ARRAY is a command list (`normalizeCommandList` splices one in),
		// so recurse rather than writing an `id` onto it that JSON.stringify drops -
		// which would leave every id inside it shared with the original.
		if (Array.isArray(command)) {
			regenerateCommandIds(command, visited);
			continue;
		}
		if (!isCommandLike(command)) continue;
		if (visited.has(command)) continue;
		visited.add(command);

		command.id = uuidv4();

		const branching = command as unknown as {
			thenCommands?: unknown;
			elseCommands?: unknown;
			choice?: unknown;
		};
		regenerateCommandIds(branching.thenCommands, visited);
		regenerateCommandIds(branching.elseCommands, visited);
		regenerateChoiceIds(branching.choice, visited);
	}
}

function regenerateChoiceIds(choice: unknown, visited: Set<unknown>): void {
	if (!isCommandLike(choice)) return;
	if (visited.has(choice)) return;
	visited.add(choice);

	const node = choice as { id?: unknown; type?: unknown; macro?: unknown; choices?: unknown };
	node.id = uuidv4();

	if (node.type === "Macro") regenerateMacroIds(node.macro, visited);
	if (node.type === "Multi" && Array.isArray(node.choices)) {
		for (const child of node.choices) regenerateChoiceIds(child, visited);
	}
}
