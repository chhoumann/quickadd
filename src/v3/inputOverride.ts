import { settingsStore } from "../settingsStore";
import { findAction } from "./actionTree";
import type { InputOverride } from "./model";

/** What the builder changed about the input `name` of the action `actionId`. */
export function actionInputOverride(actionId: string | undefined, name: string): InputOverride | undefined {
	if (actionId === undefined) return undefined;
	return findAction(settingsStore.getState().actions, actionId)?.inputs?.[name];
}

/**
 * A placeholder's modifiers with an override's label, optional and default in
 * their place. Every prompt and the one-page form read an input's modifiers
 * through this, so an override wins wherever the run asks.
 */
export function withInputOverride<T extends { label?: string; optional?: boolean; defaultValue?: string }>(
	modifiers: T,
	override: InputOverride | undefined,
): T {
	if (!override) return modifiers;
	const result = { ...modifiers };
	if (override.label) result.label = override.label;
	if (override.optional !== undefined) result.optional = override.optional;
	if (override.default !== undefined) result.defaultValue = override.default;
	return result;
}
