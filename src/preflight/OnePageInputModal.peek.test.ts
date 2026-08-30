import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type QuickAdd from "../main";
import { setQuickAddInstance } from "../quickAddInstance";
import { UserCancelError } from "../errors/UserCancelError";
import { PEEK_HIDDEN_CLASS } from "../gui/promptPeek/InputPromptPeek";
import { PromptPeekSession } from "../gui/promptPeek/PromptPeekSession";
import { clearVisiblePrompts } from "../gui/promptPeek/visiblePrompts";
import type { FieldRequirement } from "./RequirementCollector";
import { OnePageInputModal } from "./OnePageInputModal";

vi.mock("src/gui/suggesters/fileSuggester", () => ({
	FileSuggester: class {
		destroy = vi.fn();
	},
}));

vi.mock("src/gui/suggesters/tagSuggester", () => ({
	TagSuggester: class {
		destroy = vi.fn();
	},
}));

vi.mock("src/gui/suggesters/FieldValueInputSuggest", () => ({
	FieldValueInputSuggest: class {},
}));

vi.mock("src/gui/suggesters/SuggesterInputSuggest", () => ({
	SuggesterInputSuggest: class {},
}));

function makeFakeApp(selection = "") {
	return {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: () => {}, popScope: () => {} },
		workspace: {
			containerEl: document.body,
			on: () => ({}),
			getActiveFile: () => null,
			getActiveViewOfType: () =>
				selection
					? { editor: { getSelection: () => selection } }
					: undefined,
		},
		metadataCache: {
			on: () => ({}),
			getTags: () => ({}),
			getFileCache: () => undefined,
			isUserIgnored: () => false,
			unresolvedLinks: {},
		},
		vault: {
			on: () => ({}),
			getMarkdownFiles: () => [],
			getAllLoadedFiles: () => [],
			getFiles: () => [],
			getAbstractFileByPath: () => null,
		},
		fileManager: { getNewFileParent: () => ({ path: "" }) },
	};
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
	const button = Array.from(container.querySelectorAll("button")).find(
		(candidate) => candidate.textContent?.includes(label),
	);
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`Button not found: ${label}`);
	}
	return button;
}

describe("OnePageInputModal peek", () => {
	let fakeApp: ReturnType<typeof makeFakeApp>;

	beforeEach(() => {
		fakeApp = makeFakeApp();
		setQuickAddInstance({
			app: fakeApp,
			registerEvent: () => {},
		} as unknown as QuickAdd);
	});

	afterEach(() => {
		PromptPeekSession.discard();
		clearVisiblePrompts();
		for (const el of Array.from(document.body.children)) el.remove();
	});

	it("keeps the form alive across peek and resume, then submits its text", async () => {
		const modal = new OnePageInputModal(fakeApp as never, [
			{ id: "title", label: "Title", type: "text" },
		]);
		const input = modal.contentEl.querySelector("input") as HTMLInputElement;
		input.value = "Draft title";
		input.dispatchEvent(new Event("input", { bubbles: true }));

		const buttons = Array.from(
			modal.contentEl.querySelectorAll("button"),
		);
		const peekButton = findButton(modal.contentEl, "Peek at note");
		expect(peekButton.classList.contains("qa-peek-button")).toBe(true);
		expect(buttons.indexOf(findButton(modal.contentEl, "Submit"))).toBeLessThan(
			buttons.indexOf(peekButton),
		);
		peekButton.click();

		expect(modal.containerEl.classList.contains(PEEK_HIDDEN_CLASS)).toBe(true);
		expect(document.querySelector(".qa-peek-chip")).not.toBeNull();

		const settled = modal.waitForClose.then(
			(value) => ({ status: "resolved" as const, value }),
			(error) => ({ status: "rejected" as const, error }),
		);
		await Promise.resolve();
		expect(await Promise.race([settled, Promise.resolve("pending")])).toBe(
			"pending",
		);

		PromptPeekSession.getActive()?.resume();
		expect(modal.containerEl.classList.contains(PEEK_HIDDEN_CLASS)).toBe(false);
		findButton(modal.contentEl, "Submit").click();

		await expect(modal.waitForClose).resolves.toEqual({
			title: "Draft title",
		});
	});

	it("rejects when the peek chip cancels the form", async () => {
		const modal = new OnePageInputModal(fakeApp as never, [
			{ id: "title", label: "Title", type: "text" },
		]);
		findButton(modal.contentEl, "Peek at note").click();

		const chip = document.querySelector(".qa-peek-chip") as HTMLElement;
		findButton(chip, "Cancel").click();

		await expect(modal.waitForClose).rejects.toBeInstanceOf(UserCancelError);
	});

	it("opens Peek from the modal shortcut", async () => {
		const modal = new OnePageInputModal(fakeApp as never, [
			{ id: "title", label: "Title", type: "text" },
		]);
		const scope = modal.scope as unknown as {
			trigger: (key: string) => unknown;
		};

		scope.trigger("E");

		expect(modal.containerEl.classList.contains(PEEK_HIDDEN_CLASS)).toBe(true);
		expect(document.querySelector(".qa-peek-chip")).not.toBeNull();
		modal.close();
		await expect(modal.waitForClose).rejects.toBeInstanceOf(UserCancelError);
	});

	it("inserts the editor selection into the last focused text field", async () => {
		fakeApp = makeFakeApp("selected");
		setQuickAddInstance({
			app: fakeApp,
			registerEvent: () => {},
		} as unknown as QuickAdd);
		const requirements: FieldRequirement[] = [
			{
				id: "first",
				label: "First",
				type: "text",
				defaultValue: "unchanged",
			},
			{ id: "second", label: "Second", type: "text" },
		];
		const modal = new OnePageInputModal(fakeApp as never, requirements);
		const inputs = Array.from(
			modal.contentEl.querySelectorAll<HTMLInputElement>("input"),
		);
		const second = inputs[1];
		second.value = "before ";
		second.dispatchEvent(new Event("input", { bubbles: true }));
		second.focus();
		second.setSelectionRange(second.value.length, second.value.length);

		findButton(modal.contentEl, "Peek at note").click();
		const chip = document.querySelector(".qa-peek-chip") as HTMLElement;
		findButton(chip, "Insert").click();

		expect(second.value).toBe("before selected");
		findButton(modal.contentEl, "Submit").click();
		await expect(modal.waitForClose).resolves.toEqual({
			first: "unchanged",
			second: "before selected",
		});
	});

	it("keeps Peek available when the form has no free-text field", async () => {
		fakeApp = makeFakeApp("ignored");
		setQuickAddInstance({
			app: fakeApp,
			registerEvent: () => {},
		} as unknown as QuickAdd);
		const modal = new OnePageInputModal(fakeApp as never, [
			{
				id: "count",
				label: "Count",
				type: "number",
				defaultValue: "4",
			},
		]);

		findButton(modal.contentEl, "Peek at note").click();
		expect(modal.containerEl.classList.contains(PEEK_HIDDEN_CLASS)).toBe(true);
		const chip = document.querySelector(".qa-peek-chip") as HTMLElement;
		findButton(chip, "Insert").click();

		expect(modal.containerEl.classList.contains(PEEK_HIDDEN_CLASS)).toBe(false);
		findButton(modal.contentEl, "Submit").click();
		await expect(modal.waitForClose).resolves.toEqual({ count: "4" });
	});
});
