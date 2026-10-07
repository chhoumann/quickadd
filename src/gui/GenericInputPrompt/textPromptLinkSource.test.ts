// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import { settingsStore } from "../../settingsStore";
import GenericInputPrompt from "./GenericInputPrompt";
import GenericWideInputPrompt from "../GenericWideInputPrompt/GenericWideInputPrompt";
import NumberInputPrompt from "../NumberInputPrompt/NumberInputPrompt";

import { makeFakeApp } from "../../../tests/helpers/prompts/app";
import "../../../tests/helpers/prompts/dom";

/**
 * A text prompt opened for a note keeps its draft for that note: the link
 * source path is part of the draft key, so a prompt opened for another note
 * (or for no note) starts empty.
 */

let fakeApp: ReturnType<typeof makeFakeApp>;

beforeEach(() => {
	fakeApp = makeFakeApp();
	setQuickAddInstance({ app: fakeApp, registerEvent: () => {} } as unknown as QuickAdd);
	settingsStore.setState({ persistInputPromptDrafts: true });
});

afterEach(() => {
	for (const el of Array.from(document.body.children)) el.remove();
});

const prompts = {
	single: GenericInputPrompt,
	wide: GenericWideInputPrompt,
	number: NumberInputPrompt,
};

function field(): HTMLInputElement | HTMLTextAreaElement {
	return document.querySelector("input, textarea") as HTMLInputElement;
}

function open(Prompt: (typeof prompts)[keyof typeof prompts], header: string, linkSourcePath?: string) {
	return Prompt.Prompt(fakeApp as never, header, undefined, undefined, undefined, { linkSourcePath });
}

async function cancel(waitForClose: Promise<string>) {
	const button = Array.from(document.querySelectorAll("button")).find(
		(candidate) => candidate.textContent === "Cancel",
	) as HTMLButtonElement;
	button.click();
	await waitForClose.catch(() => undefined);
	for (const el of Array.from(document.body.children)) el.remove();
}

describe.each(Object.entries(prompts))("%s prompt link source", (kind, Prompt) => {
	it("restores a draft only for the note it was typed for", async () => {
		const header = `Draft for ${kind}`;
		const first = open(Prompt, header, "Notes/A.md");
		field().value = "42";
		field().dispatchEvent(new Event("input", { bubbles: true }));
		await cancel(first);

		const otherNote = open(Prompt, header, "Notes/B.md");
		expect(field().value).toBe("");
		await cancel(otherNote);

		const noNote = open(Prompt, header);
		expect(field().value).toBe("");
		await cancel(noNote);

		const sameNote = open(Prompt, header, "Notes/A.md");
		expect(field().value).toBe("42");
		await cancel(sameNote);
	});
});
