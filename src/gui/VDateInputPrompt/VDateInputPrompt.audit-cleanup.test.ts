import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import { settingsStore } from "../../settingsStore";
import { InputPromptDraftStore } from "../../utils/InputPromptDraftStore";
import VDateInputPrompt from "./VDateInputPrompt";

import { makeFakeApp } from "../../../tests/helpers/prompts/app";
import "../../../tests/helpers/prompts/dom";

interface PromptInternals {
	currentInput: string;
	previewEl: HTMLElement;
	inputComponent: { inputEl: HTMLInputElement };
}

describe("VDateInputPrompt restored-draft preview", () => {
	const draftStore = InputPromptDraftStore.getInstance();
	const header = "Pick a date";
	const placeholder = "";
	const draftKey = draftStore.makeKey({
		kind: "single",
		header,
		placeholder,
		linkSourcePath: "",
	});

	let fakeApp: ReturnType<typeof makeFakeApp>;

	beforeEach(() => {
		fakeApp = makeFakeApp();
		setQuickAddInstance({
			app: fakeApp,
			registerEvent: () => {},
		} as unknown as QuickAdd);
		settingsStore.setState({ persistInputPromptDrafts: true });
		draftStore.clearAll();
	});

	afterEach(() => {
		draftStore.clearAll();
		// Remove modal DOM the construction appended to the document body.
		for (const el of Array.from(document.body.children)) el.remove();
	});

	function construct(defaultValue: string): PromptInternals {
		// Reach the protected constructor via a cast so we can inspect state
		// (Prompt() only hands back the close promise).
		const Ctor = VDateInputPrompt as unknown as new (
			...args: unknown[]
		) => VDateInputPrompt;
		const prompt = new Ctor(
			fakeApp,
			header,
			placeholder,
			defaultValue,
			"YYYY-MM-DD",
			undefined,
			false,
		);
		return prompt as unknown as PromptInternals;
	}

	it("seeds the preview from a restored draft, not the defaultValue", () => {
		// Default parses cleanly; draft is unparseable garbage. With the bug the
		// preview reflects the (parseable) default and shows no error; with the
		// fix it reflects the (unparseable) draft and shows the error state.
		draftStore.set(draftKey, "zzzz not a real date");

		const state = construct("2025-01-15");

		expect(state.inputComponent.inputEl.value).toBe("zzzz not a real date");
		expect(state.currentInput).toBe("zzzz not a real date");
		expect(state.previewEl.classList.contains("is-error")).toBe(true);
	});

	it("keeps the no-draft default path: preview reflects the defaultValue", () => {
		// No draft stored: input + preview follow the parseable default.
		const state = construct("2025-01-15");

		expect(state.inputComponent.inputEl.value).toBe("2025-01-15");
		expect(state.currentInput).toBe("2025-01-15");
		expect(state.previewEl.classList.contains("is-error")).toBe(false);
	});
});
