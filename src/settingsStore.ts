import { createStore } from "zustand/vanilla";
import type { QuickAddSettings } from "./quickAddSettingsTab";
import { DEFAULT_SETTINGS } from "./quickAddSettingsTab";
import type { IMacro } from "./types/macros/IMacro";
import { QuickAddMacro } from "./types/macros/QuickAddMacro";

type SettingsState = QuickAddSettings;

export const settingsStore = (() => {
	const useSettingsStore = createStore<SettingsState>((set, _get) => ({
		...structuredClone(DEFAULT_SETTINGS),
	}));

	const { getState, setState, subscribe } = useSettingsStore;

	return {
		getState,
		setState,
		subscribe,
		setMacro: (macroId: IMacro["id"], macro: IMacro) => {
			setState((state) => {
				const macroIdx = state.macros.findIndex((m) => m.id === macroId);
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
			setState((state) => ({
				...state,
				macros: [...state.macros, macro],
			}));

			return macro;
		},
		getMacro: (macroId: IMacro["id"]) => {
			return getState().macros.find((m) => m.id === macroId);
		},
	};
})();
