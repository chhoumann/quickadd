import type IChoice from "../../types/choices/IChoice";

/**
 * Fast, component-free probe of ChoiceView's persistence boundary: hold choices
 * in `$state`, update immutably, and hand out a `$state.snapshot()` on save.
 *
 * ChoiceView itself is now mountable in vitest (the #1249 circular-import fix), and
 * `ChoiceView.test.ts` exercises this boundary through the real save path. This
 * `.svelte.ts` mirror is kept as an isolated, runes-level guard on the load-bearing
 * guarantee — snapshots are plain and do NOT alias the reactive source, including
 * nested branches — which is what stops `$state` proxies leaking into
 * zustand/data.json.
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
