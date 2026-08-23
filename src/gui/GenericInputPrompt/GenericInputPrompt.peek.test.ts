import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Modal } from "obsidian";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import GenericInputPrompt from "./GenericInputPrompt";
import { PromptPeekSession } from "../promptPeek/PromptPeekSession";
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
		for (const el of Array.from(document.body.children)) el.remove();
	});

	it("keeps the run alive across peek and resume, then submits the draft", async () => {
		const waitForClose = GenericInputPrompt.Prompt(fakeApp as never, "Log");
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

		expect(document.querySelector(".qaInputPrompt")).toBeNull();
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

		const restored = document.querySelector(
			".qaInputPrompt input",
		) as HTMLInputElement;
		expect(restored.value).toBe("started ");
		restored.value = "started again";
		restored.dispatchEvent(new Event("input", { bubbles: true }));
		restored.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

		await expect(waitForClose).resolves.toBe("started again");
	});

	it("cancel from the peek chip rejects like Escape", async () => {
		const waitForClose = GenericInputPrompt.Prompt(fakeApp as never, "Log");
		const peekButton = document.querySelector(
			".qaInputPrompt .qa-peek-button",
		) as HTMLButtonElement;
		expect(peekButton.textContent).toContain("Peek at note");
		peekButton.click();

		PromptPeekSession.getActive()?.cancel();

		await expect(waitForClose).rejects.toBeInstanceOf(UserCancelError);
	});
});
