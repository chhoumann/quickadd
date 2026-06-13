import type { TextInputSuggest } from "../../suggesters/suggest";

type AnySuggest = Pick<TextInputSuggest<unknown>, "destroy">;
type SuggesterFactory = (
	el: HTMLInputElement | HTMLTextAreaElement,
) => AnySuggest | AnySuggest[] | void;

function toList(result: ReturnType<SuggesterFactory>): AnySuggest[] {
	if (!result) return [];
	return Array.isArray(result) ? result : [result];
}

/**
 * Svelte action attaching one or more Obsidian input suggesters to a bound
 * `<input>`/`<textarea>`. The suggesters key themselves per inputEl+class in a
 * WeakMap (suggest.ts) and `selectSuggestion` writes `inputEl.value` then
 * dispatches a real bubbling `input` event, so the selected value round-trips
 * through Svelte `bind:value` / the element's `oninput` handler.
 *
 * Suggesters are constructed once on mount and destroyed on unmount (strictly
 * better than the imperative builders, which never destroyed them). They are
 * static per input in the choice builders, so no `update` is provided.
 */
export function suggester(
	node: HTMLInputElement | HTMLTextAreaElement,
	make: SuggesterFactory,
) {
	const made = toList(make(node));
	return {
		destroy() {
			made.forEach((instance) => instance.destroy());
		},
	};
}
