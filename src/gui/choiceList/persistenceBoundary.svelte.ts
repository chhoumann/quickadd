import type IChoice from "../../types/choices/IChoice";

/**
 * Isolated mirror of ChoiceView's persistence boundary: hold choices in `$state`,
 * update immutably, and hand out a `$state.snapshot()` on save. Exists as a
 * `.svelte.ts` module because the full ChoiceView component cannot be mounted in
 * vitest (its dependency graph has pre-existing circular imports the bundler
 * tolerates but vitest's ESM evaluation order does not). This lets us unit-test
 * the load-bearing guarantee — snapshots are plain and do NOT alias the reactive
 * source — which is what stops `$state` proxies leaking into zustand/data.json.
 */
export function createChoicesBuffer(initial: IChoice[]) {
	let choices = $state(initial);

	return {
		get value() {
			return choices;
		},
		add(choice: IChoice) {
			choices = [...choices, choice];
		},
		renameFirst(name: string) {
			if (choices[0]) choices[0].name = name;
		},
		snapshot(): IChoice[] {
			return $state.snapshot(choices) as IChoice[];
		},
	};
}
