import type { Action, ActionNode } from "./model";

/** The shape of an action with its steps and `show`, or of a folder whose every item has it. */
export function isActionNode(value: unknown): value is ActionNode {
	if (!isRecord(value) || typeof value.id !== "string") return false;
	if (value.kind === "folder") return Array.isArray(value.items) && value.items.every(isActionNode);
	return value.kind === "action" && Array.isArray(value.steps) && isRecord(value.show);
}

/** The action with this id, in folders too. */
export function findAction(actions: readonly ActionNode[] | undefined, id: string): Action | undefined {
	// An unreadable action list is kept as it was found; there is nothing in it to find.
	if (!Array.isArray(actions)) return undefined;
	for (const node of actions) {
		if (!isActionNode(node)) continue;
		if (node.kind === "action" && node.id === id) return node;
		if (node.kind === "folder") {
			const found = findAction(node.items, id);
			if (found) return found;
		}
	}
	return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The action a lowered choice belongs to: a sequence's write runs as `<action id>:choice` (lower.ts). */
export function owningActionId(choiceId: string): string {
	return choiceId.endsWith(":choice") ? choiceId.slice(0, -":choice".length) : choiceId;
}
