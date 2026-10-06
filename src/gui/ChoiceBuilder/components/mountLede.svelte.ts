import { mountComponent } from "../../svelte/mountComponent";
import Lede from "./Lede.svelte";

export interface LedeHandle {
	set(iconId: string, text: string): void;
	destroy(): void;
}

/**
 * The lede, for a page that builds its DOM imperatively (the sequence
 * builder, a branch page). The page says when what it edits changed.
 */
export function mountLede(container: HTMLElement, iconId: string, text: string): LedeHandle {
	const props = $state({ iconId, text });
	const mounted = mountComponent(container, Lede, props, { what: "this page's summary" });
	return {
		set(nextIcon, nextText) {
			props.iconId = nextIcon;
			props.text = nextText;
		},
		destroy() {
			mounted.destroy();
		},
	};
}
