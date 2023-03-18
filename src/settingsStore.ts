import { createStore } from "zustand/vanilla";
import { DEFAULT_SETTINGS, QuickAddSettings } from "./quickAddSettingsTab";
import { IMacro } from "./types/macros/IMacro";

// Define the state shape and actions for your store.
type SettingsState = QuickAddSettings & {
	setSettings: (settings: Partial<QuickAddSettings>) => void;
};

export const settingsStore = (function () {
	const useSettingsStore = createStore<SettingsState>((set, get) => ({
		...DEFAULT_SETTINGS,
		setSettings: (settings: Partial<QuickAddSettings>) =>
			set((state) => ({ ...state, ...settings })),
	}));

	const { getState, setState, subscribe } = useSettingsStore;

	return {
		getState,
		setState,
		subscribe,
		getChoices: () => {
			return getState().choices;
		},
		setMacro: (macroId: IMacro["id"], macro: IMacro) => {
			setState((state) => {
				const macros = state.macros.map((m) => {
					if (m.id === macroId) {
						return macro;
					}
					
					return m;
				});

				return { ...state, macros };
			});
		},
	};
})();
