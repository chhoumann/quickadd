import { createStore } from "zustand/vanilla";
import type { QuickAddSettings } from "./settings";
import { DEFAULT_SETTINGS } from "./settings";
import { deepClone } from "./utils/deepClone";

type SettingsState = QuickAddSettings;

export const settingsStore = (() => {
	const useSettingsStore = createStore<SettingsState>((set, _get) => ({
		...deepClone(DEFAULT_SETTINGS),
	}));

	const { getState, setState, subscribe } = useSettingsStore;

	return {
		getState,
		setState,
		subscribe,

	};
})();
