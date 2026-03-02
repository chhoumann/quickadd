import { createStore } from "zustand/vanilla";

export interface QuickAddUiState {
	choiceFilterQuery: string;
	collapsedChoiceIds: Record<string, boolean>;
}

const DEFAULT_UI_STATE: QuickAddUiState = {
	choiceFilterQuery: "",
	collapsedChoiceIds: {},
};

export const uiStore: {
	getState: () => QuickAddUiState;
	setState: (partial: Partial<QuickAddUiState>) => void;
	subscribe: (listener: (state: QuickAddUiState) => void) => () => void;
} = (() => {
	const store = createStore<QuickAddUiState>(() => ({
		...DEFAULT_UI_STATE,
	}));

	return {
		getState: store.getState,
		setState: (partial) => {
			store.setState((state) => ({ ...state, ...partial }));
		},
		subscribe: (listener) =>
			store.subscribe((state) => {
				listener(state);
			}),
	};
})();
