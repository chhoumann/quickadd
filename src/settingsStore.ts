import type { QuickAddSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";
import { deepClone } from "./utils/deepClone";

type Listener = (state: QuickAddSettings, previous: QuickAddSettings) => void;
type Update = Partial<QuickAddSettings> | ((state: QuickAddSettings) => Partial<QuickAddSettings>);

export const settingsStore = (() => {
	let state: QuickAddSettings = deepClone(DEFAULT_SETTINGS);
	const listeners = new Set<Listener>();

	const commit = (next: QuickAddSettings) => {
		if (Object.is(next, state)) return;
		const previous = state;
		state = next;
		for (const listener of listeners) listener(state, previous);
	};

	return {
		getState: () => state,
		/** Shallow-merges the update, so settings it leaves out keep their identity. */
		setState: (update: Update) => {
			const partial = typeof update === "function" ? update(state) : update;
			if (Object.is(partial, state)) return;
			commit({ ...state, ...partial });
		},
		replaceState: (next: QuickAddSettings) => commit(next),
		subscribe: (listener: Listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
})();
