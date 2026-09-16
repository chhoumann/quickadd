import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import GenericInputPrompt from "./GenericInputPrompt";
import GenericWideInputPrompt from "../GenericWideInputPrompt/GenericWideInputPrompt";

import { makeFakeApp } from "../../../tests/helpers/prompts/app";
import "../../../tests/helpers/prompts/dom";

interface Suggester {
	destroy: () => void;
	destroyed?: boolean;
}
interface PromptInternals {
	waitForClose: Promise<string>;
	fileSuggester: Suggester;
	tagSuggester: Suggester;
	close: () => void;
}

const prompts: Array<{ name: string; Ctor: unknown }> = [
	{ name: "GenericInputPrompt", Ctor: GenericInputPrompt },
	{ name: "GenericWideInputPrompt", Ctor: GenericWideInputPrompt },
];

describe.each(prompts)("$name releases its suggesters on close", ({ Ctor }) => {
	let fakeApp: ReturnType<typeof makeFakeApp>;

	beforeEach(() => {
		fakeApp = makeFakeApp();
		setQuickAddInstance({
			app: fakeApp,
			registerEvent: () => {},
		} as unknown as QuickAdd);
	});

	afterEach(() => {
		for (const el of Array.from(document.body.children)) el.remove();
	});

	it("destroys both the file and tag suggesters in onClose", () => {
		const Make = Ctor as new (...args: unknown[]) => PromptInternals;
		const prompt = new Make(fakeApp, "Header", "", "");

		// Closing without submit rejects waitForClose; swallow it so the rejection
		// is handled (the test is about teardown, not the resolution contract).
		prompt.waitForClose.catch(() => undefined);

		const fileDestroy = vi.spyOn(prompt.fileSuggester, "destroy");
		const tagDestroy = vi.spyOn(prompt.tagSuggester, "destroy");

		prompt.close(); // Modal stub close() -> onClose()

		expect(fileDestroy).toHaveBeenCalledTimes(1);
		expect(tagDestroy).toHaveBeenCalledTimes(1);
		// destroy() ran to completion (not merely invoked): the base TextInputSuggest
		// sets `destroyed` first thing, the flag that blocks any late re-open.
		expect(prompt.fileSuggester.destroyed).toBe(true);
		expect(prompt.tagSuggester.destroyed).toBe(true);
	});
});
