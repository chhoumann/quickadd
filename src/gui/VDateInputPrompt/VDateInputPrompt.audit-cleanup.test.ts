import { afterEach, beforeEach, describe, expect, it } from "vitest";
import realMoment from "moment";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import { settingsStore } from "../../settingsStore";
import { InputPromptDraftStore } from "../../utils/InputPromptDraftStore";
import VDateInputPrompt from "./VDateInputPrompt";
import { NOT_A_DATE } from "../../utils/dateParser";

import { makeFakeApp } from "../../../tests/helpers/prompts/app";
import "../../../tests/helpers/prompts/dom";

interface PromptInternals {
	currentInput: string;
	previewEl: HTMLElement;
	inputComponent: { inputEl: HTMLInputElement };
	transformInputOnSubmit(input: string): string;
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

	it("shows a kept submitted date as the date, and submits that exact date again", () => {
		// A cancelled run keeps what this prompt submitted: `@date:<ISO>`.
		draftStore.set(draftKey, "@date:2026-09-30T10:00:00.000Z");
		const stubMoment = window.moment;
		window.moment = ((input?: string) => realMoment.utc(input)) as typeof window.moment;
		try {
			const state = construct("");

			expect(state.inputComponent.inputEl.value).toBe("2026-09-30");
			expect(state.previewEl.textContent).toBe("2026-09-30");
			expect(state.transformInputOnSubmit(state.inputComponent.inputEl.value))
				.toBe("@date:2026-09-30T10:00:00.000Z");
		} finally {
			window.moment = stubMoment;
		}
	});

	it("leaves a kept @date: value that isn't a date in the field as it is", () => {
		draftStore.set(draftKey, "@date:not-a-date-with-details");
		const stubMoment = window.moment;
		window.moment = ((input?: string) => realMoment.utc(input)) as typeof window.moment;
		try {
			const state = construct("");

			expect(state.inputComponent.inputEl.value).toBe("@date:not-a-date-with-details");
			expect(state.transformInputOnSubmit(state.inputComponent.inputEl.value))
				.toBe("@date:not-a-date-with-details");
		} finally {
			window.moment = stubMoment;
		}
	});

	it("keeps the no-draft default path: preview reflects the defaultValue", () => {
		// No draft stored: input + preview follow the parseable default.
		const state = construct("2025-01-15");

		expect(state.inputComponent.inputEl.value).toBe("2025-01-15");
		expect(state.currentInput).toBe("2025-01-15");
		expect(state.previewEl.classList.contains("is-error")).toBe(false);
	});

	it("says nothing until there is something typed, like the one-page date field", () => {
		const state = construct("");

		expect(state.previewEl.textContent).toBe("");
		expect(state.previewEl.hidden).toBe(true);
	});

	it("says Not a date, the one-page form's words, for text that is not a date", () => {
		draftStore.set(draftKey, "zzzz not a real date");
		const state = construct("");

		expect(state.previewEl.hidden).toBe(false);
		expect(state.previewEl.textContent).toBe(NOT_A_DATE);
		expect(state.previewEl.classList.contains("is-error")).toBe(true);
	});
});
