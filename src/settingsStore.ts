import { createStore } from "zustand/vanilla";
import type { QuickAddSettings } from "./quickAddSettingsTab";
import { DEFAULT_SETTINGS } from "./quickAddSettingsTab";

type SettingsState = QuickAddSettings;

export const settingsStore = (() => {
	const useSettingsStore = createStore<SettingsState>((_set, _get) => ({
		...structuredClone(DEFAULT_SETTINGS),
	}));

	const { getState, setState, subscribe } = useSettingsStore;

	return {
		getState,
		setState,
		subscribe,
	};
})();
