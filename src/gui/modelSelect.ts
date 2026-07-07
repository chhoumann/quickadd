import type { DropdownComponent } from "obsidian";
import { resolveModel } from "src/ai/aiHelpers";
import type { ModelRef } from "src/ai/Provider";
import { activeModelRef } from "src/ai/Provider";
import { settingsStore } from "src/settingsStore";

/**
 * What a model dropdown reads and writes: the legacy name string (or the
 * "Ask me" sentinel) plus the provider-scoped ref. Writers keep both in sync —
 * `model === modelRef.name` whenever `modelRef` is set (see IAIAssistantCommand).
 */
export interface ModelSelection {
	model: string;
	modelRef?: ModelRef;
}

const ASK_ME = "Ask me";
// Option value for the disabled placeholder that surfaces a stored-but-missing
// model. Providers/models can't collide with it: option values for real models
// are always "<qualified>:<index>" built below.
const MISSING_VALUE = "__qa-missing-model__";

/**
 * Populate a model dropdown, grouped per provider so two providers serving the
 * same model name (#1495) are distinguishable, and keep BOTH persisted fields
 * (legacy name + provider-scoped ref) in sync on selection.
 *
 * - "Ask me" stays the first, top-level option.
 * - A stored model that no longer exists is shown as a disabled "(missing)"
 *   entry instead of silently snapping to the first option.
 * - A legacy bare-name selection (no ref) preselects the entry the runtime's
 *   first-match rule would use, so the dropdown shows what would actually run.
 */
export function populateModelDropdown(
	dropdown: DropdownComponent,
	current: ModelSelection,
	onSelect: (selection: ModelSelection) => void,
): void {
	const providers = settingsStore.getState().ai.providers;
	const selectEl = dropdown.selectEl;
	const doc = selectEl.ownerDocument;

	// A ref that no longer matches the legacy string is stale (older QuickAdd
	// edited the command); the string is what the user last visibly chose.
	current = {
		model: current.model,
		modelRef: activeModelRef(current.model, current.modelRef),
	};

	dropdown.addOption(ASK_ME, ASK_ME);

	// Option values must be unique even when names repeat across providers and
	// providers lack ids (hand-edited data.json), so key by entry index.
	const entriesByValue = new Map<
		string,
		{ providerId?: string; modelName: string }
	>();

	let index = 0;
	for (const provider of providers) {
		if (provider.models.length === 0) continue;

		const group = doc.createElement("optgroup");
		group.label = provider.name;
		selectEl.appendChild(group);

		for (const model of provider.models) {
			const value = `${provider.id ?? provider.name}/${model.name}:${index++}`;
			entriesByValue.set(value, {
				providerId: provider.id,
				modelName: model.name,
			});

			const option = doc.createElement("option");
			option.value = value;
			option.text = model.name;
			group.appendChild(option);
		}
	}

	const selectedValue = findSelectedValue(current, entriesByValue);
	if (selectedValue) {
		dropdown.setValue(selectedValue);
	} else {
		// The stored model was deleted (or its provider was). Reflect the saved
		// value with a disabled entry instead of silently showing the first
		// option while a different value persists.
		const label = current.modelRef
			? `${current.modelRef.providerId}/${current.modelRef.name}`
			: current.model;
		dropdown.addOption(MISSING_VALUE, `(missing) ${label}`);
		const missingOption = Array.from(selectEl.options).find(
			(option) => option.value === MISSING_VALUE,
		);
		if (missingOption) missingOption.disabled = true;
		dropdown.setValue(MISSING_VALUE);
	}

	dropdown.onChange((value) => {
		if (value === MISSING_VALUE) return;
		if (value === ASK_ME) {
			onSelect({ model: ASK_ME, modelRef: undefined });
			return;
		}

		const entry = entriesByValue.get(value);
		if (!entry) return;

		onSelect({
			model: entry.modelName,
			// A provider without an id (hand-edited data.json that hasn't passed
			// through the id backfill yet) can't be pinned; the bare name keeps
			// legacy first-match behavior.
			modelRef: entry.providerId
				? { providerId: entry.providerId, name: entry.modelName }
				: undefined,
		});
	});
}

function findSelectedValue(
	current: ModelSelection,
	entriesByValue: Map<string, { providerId?: string; modelName: string }>,
): string | undefined {
	if (!current.model || current.model === ASK_ME) return ASK_ME;

	if (current.modelRef) {
		for (const [value, entry] of entriesByValue) {
			if (
				entry.providerId === current.modelRef.providerId &&
				entry.modelName === current.modelRef.name
			) {
				return value;
			}
		}
		return undefined;
	}

	// Legacy bare name: preselect the provider the runtime would first-match.
	// Silent — rendering a dropdown must not consume the runtime warn-once budget.
	const resolved = resolveModel(current.model, { silent: true });
	if (!resolved) return undefined;
	for (const [value, entry] of entriesByValue) {
		if (
			entry.providerId === resolved.provider.id &&
			entry.modelName === resolved.model.name
		) {
			return value;
		}
	}
	return undefined;
}
