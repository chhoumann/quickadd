import { createStore } from "zustand/vanilla";

export interface QuickAddUiState {
	collapsedChoiceIds: Record<string, boolean>;
}

const DEFAULT_UI_STATE: QuickAddUiState = {
	collapsedChoiceIds: {},
};

export const uiStore: {
	getState: () => QuickAddUiState;
	setState: (partial: Partial<QuickAddUiState>) => void;
	subscribe: (listener: (state: QuickAddUiState) => void) => () => void;
	pruneCollapsedChoiceIds: (validChoiceIds: Iterable<string>) => void;
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
		pruneCollapsedChoiceIds: (validChoiceIds) => {
			const allowedIds = new Set(validChoiceIds);
			store.setState((state) => {
				const filteredEntries = Object.entries(state.collapsedChoiceIds).filter(
					([choiceId]) => allowedIds.has(choiceId),
				);
				if (filteredEntries.length === Object.keys(state.collapsedChoiceIds).length) {
					return state;
				}
				return {
					...state,
					collapsedChoiceIds: Object.fromEntries(filteredEntries),
				};
			});
		},
	};
})();
