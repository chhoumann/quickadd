import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Modal } from "obsidian";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import GenericInputPrompt from "./GenericInputPrompt";
import { PEEK_HIDDEN_CLASS } from "../promptPeek/InputPromptPeek";
import { PromptPeekSession } from "../promptPeek/PromptPeekSession";
import { clearVisiblePrompts } from "../promptPeek/visiblePrompts";
import { UserCancelError } from "../../errors/UserCancelError";

const modalProto = Modal.prototype as unknown as {
	onOpen?: unknown;
	onClose?: unknown;
};
if (typeof modalProto.onOpen !== "function") modalProto.onOpen = () => {};
if (typeof modalProto.onClose !== "function") modalProto.onClose = () => {};

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

describe("GenericInputPrompt peek", () => {
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

	it("keeps the run alive across peek and resume, then submits the draft", async () => {
		const waitForClose = GenericInputPrompt.Prompt(
			fakeApp as never,
			"Log",
			undefined,
			undefined,
			undefined,
			{ allowPeek: true },
		);
		const input = document.querySelector(
			".qaInputPrompt input",
		) as HTMLInputElement;
		input.value = "started ";
		input.dispatchEvent(new Event("input", { bubbles: true }));

		const peekButton = document.querySelector(
			".qaInputPrompt .qa-peek-button",
		) as HTMLButtonElement;
		expect(peekButton.textContent).toContain("Peek at note");
		peekButton.click();

		// Hidden, not closed: the same input survives the peek.
		const container = document.querySelector(".qaInputPrompt") as HTMLElement;
		expect(container.classList.contains(PEEK_HIDDEN_CLASS)).toBe(true);
		expect(document.querySelector(".qa-peek-chip")).not.toBeNull();

		const settled = waitForClose.then(
			(value) => ({ status: "resolved" as const, value }),
			(error) => ({ status: "rejected" as const, error }),
		);
		await Promise.resolve();
		expect(await Promise.race([settled, Promise.resolve("pending")])).toBe(
			"pending",
		);

		PromptPeekSession.getActive()?.resume();

		expect(container.classList.contains(PEEK_HIDDEN_CLASS)).toBe(false);
		const restored = document.querySelector(
			".qaInputPrompt input",
		) as HTMLInputElement;
		expect(restored).toBe(input);
		expect(restored.value).toBe("started ");
		restored.value = "started again";
		restored.dispatchEvent(new Event("input", { bubbles: true }));
		restored.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

		await expect(waitForClose).resolves.toBe("started again");
	});

	it("keeps edits made while hidden, like a late image-paste insertion", async () => {
		const waitForClose = GenericInputPrompt.Prompt(
			fakeApp as never,
			"Log",
			undefined,
			undefined,
			undefined,
			{ allowPeek: true },
		);
		const input = document.querySelector(
			".qaInputPrompt input",
		) as HTMLInputElement;
		input.value = "shot: ";
		input.dispatchEvent(new Event("input", { bubbles: true }));

		(
			document.querySelector(
				".qaInputPrompt .qa-peek-button",
			) as HTMLButtonElement
		).click();

		// The field is alive while hidden, so a paste save that finishes now
		// still lands its embed link in the draft (the old close-and-remount
		// approach dropped it).
		input.value = "shot: ![[image.png]]";
		input.dispatchEvent(new Event("input", { bubbles: true }));

		PromptPeekSession.getActive()?.resume();
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

		await expect(waitForClose).resolves.toBe("shot: ![[image.png]]");
	});

	it("cancel from the peek chip rejects like Escape", async () => {
		const waitForClose = GenericInputPrompt.Prompt(
			fakeApp as never,
			"Log",
			undefined,
			undefined,
			undefined,
			{ allowPeek: true },
		);
		const peekButton = document.querySelector(
			".qaInputPrompt .qa-peek-button",
		) as HTMLButtonElement;
		peekButton.click();

		PromptPeekSession.getActive()?.cancel();

		await expect(waitForClose).rejects.toBeInstanceOf(UserCancelError);
	});

	it("offers no peek button unless the caller opts in", async () => {
		const waitForClose = GenericInputPrompt.Prompt(fakeApp as never, "Rename");
		expect(document.querySelector(".qa-peek-button")).toBeNull();

		const input = document.querySelector(
			".qaInputPrompt input",
		) as HTMLInputElement;
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "E",
				shiftKey: true,
				ctrlKey: true,
			}),
		);
		expect(PromptPeekSession.isPeeking()).toBe(false);

		input.value = "done";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		await expect(waitForClose).resolves.toBe("done");
	});

	it("keeps Ok ahead of Peek in the tab order", async () => {
		const waitForClose = GenericInputPrompt.Prompt(
			fakeApp as never,
			"Log",
			undefined,
			undefined,
			undefined,
			{ allowPeek: true },
		);
		const buttons = Array.from(
			document.querySelectorAll(".qaInputPrompt .qa-prompt-actions button"),
		).map((button) => button.textContent);
		expect(buttons.indexOf("Ok")).toBeLessThan(
			buttons.findIndex((text) => text?.includes("Peek at note")),
		);

		const input = document.querySelector(
			".qaInputPrompt input",
		) as HTMLInputElement;
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		await expect(waitForClose).resolves.toBe("");
	});

	it("keeps prompt actions on one compact row on a phone-width window", async () => {
		const originalWidth = window.innerWidth;
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 390,
		});
		try {
			const waitForClose = GenericInputPrompt.Prompt(
				fakeApp as never,
				"Log",
				undefined,
				undefined,
				undefined,
				{ allowPeek: true },
			);
			const modal = document.querySelector(".qaInputPrompt");
			const peekButton = document.querySelector(
				".qaInputPrompt .qa-peek-button",
			) as HTMLButtonElement;
			expect(modal?.classList.contains("qa-prompt-compact")).toBe(true);
			expect(peekButton.textContent).toContain("Peek");
			expect(peekButton.textContent).not.toContain("Peek at note");

			const input = document.querySelector(
				".qaInputPrompt input",
			) as HTMLInputElement;
			input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
			await expect(waitForClose).resolves.toBe("");
		} finally {
			Object.defineProperty(window, "innerWidth", {
				configurable: true,
				value: originalWidth,
			});
		}
	});
});
