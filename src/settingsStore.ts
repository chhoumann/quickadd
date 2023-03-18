import { createStore } from "zustand/vanilla";
import { DEFAULT_SETTINGS, QuickAddSettings } from "./quickAddSettingsTab";
import { IMacro } from "./types/macros/IMacro";
import { QuickAddMacro } from "./types/macros/QuickAddMacro";

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
				const macroIdx = state.macros.findIndex((m) => m.id === macroId);
				if (macroIdx === -1) {
					throw new Error("Macro not found");
				}

				state.macros[macroIdx] = macro;

				return state;
			});
		},
		createMacro: (name: string) => {
			if (name === "" || getState().macros.some((m) => m.name === name)) {
				throw new Error("Invalid macro name");
			}

			setState((state) => {
				const macro = new QuickAddMacro(name);
				state.macros.push(macro);

				return state;
			});
		},
	};
})();
