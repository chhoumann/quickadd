import { testApp } from "../../../tests/helpers/settings/modalApp";
import { collectUnhandledRejections } from "../../../tests/helpers/unhandledRejections";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

import { Notice, TextComponent, TFile } from "obsidian";
import { fireEvent } from "@testing-library/svelte";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import { CommandSequenceEditor } from "./CommandSequenceEditor";
import InputSuggester from "../InputSuggester/inputSuggester";
import { promptCancelled } from "../../errors/UserCancelError";
import { log } from "../../logger/logManager";

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string }>;
};
const noticeClass = Notice as unknown as NoticeTestClass;


function getInputByPlaceholder(
	container: HTMLElement,
	placeholder: string
): HTMLInputElement {
	const input = Array.from(
		container.querySelectorAll<HTMLInputElement>("input")
	).find((el) => el.placeholder === placeholder);
	if (!input) throw new Error(`Input "${placeholder}" not found`);
	return input;
}

/** Walk up from a control to the Setting wrapper that holds the "Add" button. */
function getAddButtonFor(input: HTMLInputElement): HTMLButtonElement {
	let node: HTMLElement | null = input.parentElement;
	while (node) {
		const button = Array.from(
			node.querySelectorAll<HTMLButtonElement>("button")
		).find((b) => b.textContent === "Add");
		if (button) return button;
		node = node.parentElement;
	}
	throw new Error("Add button not found");
}

describe("CommandSequenceEditor silent-add feedback", () => {
	beforeAll(() => {
		// The test obsidian stub's TextComponent lacks getValue(); back-fill it from
		// the underlying input element (harness gap, not a code bug).
		const textProto = TextComponent.prototype as unknown as {
			getValue?: () => string;
			inputEl: HTMLInputElement;
		};
		textProto.getValue ??= function getValue(this: {
			inputEl: HTMLInputElement;
		}) {
			return this.inputEl.value;
		};

		// vitest-setup back-fills addClass/removeClass but not toggleClass, which the
		// user-script row's onChange uses to show/hide the Add button.
		const elProto = HTMLElement.prototype as unknown as {
			toggleClass?: (classes: string | string[], value: boolean) => void;
		};
		elProto.toggleClass ??= function toggleClass(
			this: HTMLElement,
			classes: string | string[],
			value: boolean
		) {
			const list = Array.isArray(classes) ? classes : [classes];
			for (const cls of list) this.classList.toggle(cls, value);
		};
	});

	beforeEach(() => {
		noticeClass.instances.length = 0;
	});

	it("warns when adding a choice name that matches no existing choice", async () => {
		const choices: IChoice[] = [
			{
				id: "c1",
				name: "Real Choice",
				type: "Template",
				command: false,
			} as IChoice,
		];

		const onCommandsChange = vi.fn();
		const editor = new CommandSequenceEditor({
			app: testApp(),
			plugin: { settings: { choices } } as unknown as QuickAdd,
			commands: [],
			choices,
			onCommandsChange,
		});

		const container = document.createElement("div");
		document.body.appendChild(container);
		editor.render(container);

		const input = getInputByPlaceholder(container, "Choice");

		await fireEvent.input(input, { target: { value: "Nonexistent" } });
		await fireEvent.click(getAddButtonFor(input));

		// No command added, and the user is told why.
		expect(onCommandsChange).not.toHaveBeenCalled();
		expect(
			noticeClass.instances.some((n) => n.message.includes("Nonexistent"))
		).toBe(true);

		editor.destroy();
	});

	it("warns when adding a user-script name that resolves to nothing", async () => {
		const onCommandsChange = vi.fn();
		const editor = new CommandSequenceEditor({
			app: testApp(),
			plugin: { settings: { choices: [] } } as unknown as QuickAdd,
			commands: [],
			choices: [],
			onCommandsChange,
		});

		const container = document.createElement("div");
		document.body.appendChild(container);
		editor.render(container);

		const input = getInputByPlaceholder(
			container,
			"Start typing script name..."
		);

		await fireEvent.input(input, {
			target: { value: "missingScript" },
		});

		await fireEvent.click(getAddButtonFor(input));
		// addUserScriptFromInput is async; flush microtasks.
		await Promise.resolve();
		await Promise.resolve();

		expect(onCommandsChange).not.toHaveBeenCalled();
		expect(
			noticeClass.instances.some((n) => n.message.includes("missingScript"))
		).toBe(true);

		editor.destroy();
	});
});

/**
 * Obsidian drops a Setting button's click promise, so pressing Escape in the script
 * picker used to be an unhandled rejection that Obsidian's dev:errors listed as
 * `MacroAbortError: Input cancelled by user`.
 */
describe("CommandSequenceEditor script picker (Browse)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function renderEditor() {
		const app = testApp();
		const script = new TFile();
		script.path = "Scripts/ask.js";
		script.name = "ask.js";
		script.basename = "ask";
		script.extension = "js";
		app.vault.getFiles = () => [script];

		const onCommandsChange = vi.fn();
		const editor = new CommandSequenceEditor({
			app,
			plugin: { settings: { choices: [] } } as unknown as QuickAdd,
			commands: [],
			choices: [],
			onCommandsChange,
		});
		const container = document.createElement("div");
		document.body.appendChild(container);
		editor.render(container);

		const browse = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Browse",
		);
		if (!browse) throw new Error("Browse button not found");
		return { editor, browse, onCommandsChange };
	}

	it("stays quiet when the user dismisses the picker", async () => {
		const suggest = vi
			.spyOn(InputSuggester, "Suggest")
			.mockRejectedValue(promptCancelled());
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const { editor, browse, onCommandsChange } = renderEditor();

		const unhandled = await collectUnhandledRejections(() => fireEvent.click(browse));

		expect(suggest).toHaveBeenCalledTimes(1);
		expect(unhandled).toEqual([]);
		expect(logError).not.toHaveBeenCalled();
		expect(onCommandsChange).not.toHaveBeenCalled();
		editor.destroy();
	});

	it("reports a real failure with context instead of leaving it unhandled", async () => {
		vi.spyOn(InputSuggester, "Suggest").mockRejectedValue(new Error("picker broke"));
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const { editor, browse } = renderEditor();

		const unhandled = await collectUnhandledRejections(() => fireEvent.click(browse));

		expect(unhandled).toEqual([]);
		expect(logError).toHaveBeenCalledTimes(1);
		expect((logError.mock.calls[0][0] as Error).message).toBe(
			"Couldn't add that script: picker broke",
		);
		editor.destroy();
	});
});
