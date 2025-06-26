import { createStore } from "zustand/vanilla";
import type { QuickAddSettings } from "./quickAddSettingsTab";
import { DEFAULT_SETTINGS } from "./quickAddSettingsTab";
import type { IMacro } from "./types/macros/IMacro";
import { QuickAddMacro } from "./types/macros/QuickAddMacro";
import type IChoice from "./types/choices/IChoice";

type SettingsState = QuickAddSettings;

export const settingsStore = (() => {
	const useSettingsStore = createStore<SettingsState>((set: (fn: (state: SettingsState) => SettingsState) => void, _get: () => SettingsState) => ({
		...structuredClone(DEFAULT_SETTINGS),
	}));

	const { getState, setState, subscribe } = useSettingsStore;

	return {
		getState,
		setState,
		subscribe,
		setMacro: (macroId: IMacro["id"], macro: IMacro): void => {
			setState((state: SettingsState) => {
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
		createMacro: (name: string): IMacro => {
			if (name === "" || getState().macros.some((m) => m.name === name)) {
				throw new Error("Invalid macro name");
			}

			const macro = new QuickAddMacro(name);
			setState((state: SettingsState) => ({
				...state,
				macros: [...state.macros, macro],
			}));

			return macro;
		},
		getMacro: (macroId: IMacro["id"]) => {
			return getState().macros.find((m) => m.id === macroId);
		},
		/* -------------------- Choice CRUD helpers -------------------- */
		createChoice: (choice: IChoice) => {
			setState((state) => ({
				...state,
				choices: [...state.choices, choice],
			}));

			return choice.id;
		},
		updateChoice: (id: IChoice["id"], updates: Partial<IChoice>): void => {
			setState((state: SettingsState) => {
				const idx = state.choices.findIndex((c) => c.id === id);
				if (idx === -1) return state;
				const newChoices = [...state.choices];
				newChoices[idx] = { ...newChoices[idx], ...updates } as IChoice;
				return { ...state, choices: newChoices };
			});
		},
		deleteChoice: (id: IChoice["id"]): void => {
			setState((state: SettingsState) => ({
				...state,
				choices: state.choices.filter((c) => c.id !== id),
			}));
		},
		getChoice: (id: IChoice["id"]) => {
			return getState().choices.find((c) => c.id === id) ?? null;
		},
	};
})();
