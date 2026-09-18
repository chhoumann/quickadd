import { App } from "obsidian";
import { render } from "@testing-library/svelte";
import { vi } from "vitest";
import ChoiceView from "../../../src/gui/choiceList/ChoiceView.svelte";
import type QuickAdd from "../../../src/main";
import type IChoice from "../../../src/types/choices/IChoice";
import type { Plain } from "../../../src/gui/svelte/persist.svelte";

export function renderChoiceView(
	choices: IChoice[],
	saveChoices: (next: Plain<IChoice[]>) => void = vi.fn(),
) {
	return render(ChoiceView, {
		props: { app: new App(), plugin: {} as QuickAdd, choices, saveChoices },
	});
}
