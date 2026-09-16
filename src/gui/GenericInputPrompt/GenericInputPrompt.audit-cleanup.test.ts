import { beforeEach, describe, it, expect } from "vitest";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import { isSkipPromptShortcut } from "../promptShortcuts";
import GenericInputPrompt from "./GenericInputPrompt";
import GenericWideInputPrompt from "../GenericWideInputPrompt/GenericWideInputPrompt";
import { makeFakeApp } from "../../../tests/helpers/prompts/app";
import "../../../tests/helpers/prompts/dom";

const ctrlShift = { ctrlKey: true, shiftKey: true };
const cmdShift = { metaKey: true, shiftKey: true };
const keyEvent = (parts: KeyboardEventInit) =>
	new KeyboardEvent("keydown", { key: "Enter", ...parts });

describe("isSkipPromptShortcut", () => {
	const cases: { name: string; keys: KeyboardEventInit[]; matches: boolean }[] = [
		{ name: "matches ctrl+shift+Enter", keys: [ctrlShift], matches: true },
		{ name: "matches cmd+shift+Enter", keys: [cmdShift], matches: true },
		{ name: "does not match plain Enter (the normal submit gesture)", keys: [{}], matches: false },
		{
			name: "does not match ctrl/cmd+Enter (the wide prompt submit gesture)",
			keys: [{ ctrlKey: true }, { metaKey: true }],
			matches: false,
		},
		{ name: "does not match shift+Enter alone (no modifier)", keys: [{ shiftKey: true }], matches: false },
		{ name: "requires the Enter key", keys: [{ ...ctrlShift, key: "a" }], matches: false },
		{ name: "ignores IME composition", keys: [{ ...ctrlShift, isComposing: true }], matches: false },
	];
	for (const { name, keys, matches } of cases) {
		it(name, () => {
			for (const key of keys) expect(isSkipPromptShortcut(keyEvent(key))).toBe(matches);
		});
	}
});

const app = makeFakeApp();
beforeEach(() => {
	setQuickAddInstance({ app, registerEvent: () => {} } as unknown as QuickAdd);
});

const groups = [
	{
		name: "submitEnterCallback routing (generic/number/slider)",
		Prompt: GenericInputPrompt,
		selector: ".qaInputPrompt input",
		cases: [
			{
				name: "ctrl/cmd+shift+Enter skips on optional prompts",
				keys: [ctrlShift],
				optional: true,
				expected: "",
			},
			{
				name: "ctrl/cmd+shift+Enter does not skip on non-optional prompts",
				keys: [ctrlShift],
				optional: false,
				expected: "answer",
			},
			{ name: "plain Enter still submits on optional prompts", keys: [{}], optional: true, expected: "answer" },
		],
	},
	{
		name: "submitEnterCallback routing (wide prompt, issue #1259 collision)",
		Prompt: GenericWideInputPrompt,
		selector: ".qaWideInputPrompt textarea",
		cases: [
			{
				name: "ctrl/cmd+shift+Enter skips instead of submitting on optional prompts",
				keys: [ctrlShift, cmdShift],
				optional: true,
				expected: "",
			},
			{
				name: "ctrl/cmd+Enter still submits (submit binding preserved)",
				keys: [{ ctrlKey: true }, { metaKey: true }],
				optional: true,
				expected: "answer",
			},
			{
				name: "ctrl/cmd+shift+Enter submits on non-optional wide prompts (unchanged)",
				keys: [ctrlShift],
				optional: false,
				expected: "answer",
			},
		],
	},
];

for (const { name, Prompt, selector, cases } of groups) {
	describe(name, () => {
		for (const { name, keys, optional, expected } of cases) {
			it(name, async () => {
				for (const key of keys) {
					const result = Prompt.Prompt(
						app as never, "Header", "", "answer", undefined, { optional },
					);
					const input = document.querySelector(selector);
					expect(input).not.toBeNull();
					input?.dispatchEvent(keyEvent(key));
					await expect(result).resolves.toBe(expected);
				}
			});
		}
	});
}
