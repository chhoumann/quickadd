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
		setMacro: (macroId: IMacro["id"], macro: IMacro) => {
			setState((state) => {
				const macroIdx = state.macros.findIndex(
					(m) => m.id === macroId
				);
				if (macroIdx === -1) {
					throw new Error("Macro not found");
				}

				const newState = {
					...state,
					macros: [...state.macros],
				};

				newState.macros[macroIdx] = macro;

				return newState;
			});
		},
		createMacro: (name: string) => {
			if (name === "" || getState().macros.some((m) => m.name === name)) {
				throw new Error("Invalid macro name");
			}

			const macro = new QuickAddMacro(name);
			console.log("macros length", getState().macros.length);
			setState((state) => ({
				...state,
				macros: [...state.macros, macro],
			}));
			console.log("macros length", getState().macros.length);

			return macro;
		},
		getMacro: (macroId: IMacro["id"]) => {
			return getState().macros.find((m) => m.id === macroId);
		},
	};
})();
