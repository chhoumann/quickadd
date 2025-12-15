import { createStore } from "zustand/vanilla";
import type { QuickAddSettings } from "./quickAddSettingsTab";
import { DEFAULT_SETTINGS } from "./quickAddSettingsTab";
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
