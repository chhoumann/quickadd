import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Modal } from "obsidian";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import GenericWideInputPrompt from "./GenericWideInputPrompt";

// The obsidian-stub Modal does not implement onOpen/onClose; the prompt calls
// super.onOpen()/super.onClose(). Provide no-ops so construction and close do not
// throw. Guarded so a richer stub still wins. (Mirrors the suggester-cleanup test.)
const modalProto = Modal.prototype as unknown as {
	onOpen?: unknown;
	onClose?: unknown;
};
if (typeof modalProto.onOpen !== "function") modalProto.onOpen = () => {};
if (typeof modalProto.onClose !== "function") modalProto.onClose = () => {};

const htmlProto = HTMLElement.prototype as unknown as {
	toggleClass?: unknown;
	setAttr?: unknown;
};
if (typeof htmlProto.toggleClass !== "function") {
	htmlProto.toggleClass = function toggleClass(
		this: Element,
		cls: string,
		value: boolean,
	) {
		this.classList.toggle(cls, value);
	};
}
if (typeof htmlProto.setAttr !== "function") {
	htmlProto.setAttr = function setAttr(
		this: Element,
		name: string,
		value: string | number | boolean | null,
	) {
		if (value === null || value === false) this.removeAttribute(name);
		else this.setAttribute(name, String(value));
	};
}

function makeFakeApp() {
	return {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: () => {}, popScope: () => {} },
		workspace: { on: () => ({}), getActiveFile: () => null },
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

/**
 * Drives the REAL wide prompt through its PUBLIC contract: open it via the static
 * Prompt(), type into the rendered textarea, fire the documented ctrl+Enter submit
 * gesture, and resolve the value the formatter / quickAddApi.wideInputPrompt()
 * consumer receives. `typed` is the literal text the user keys in (so "C:\\temp" in
 * source is the on-screen `C:\temp`).
 */
function submitWideValue(typed: string): Promise<string> {
	const waitForClose = GenericWideInputPrompt.Prompt(fakeApp as never, "Header");
	const textarea = document.querySelector(
		"textarea.wideInputPromptInputEl",
	) as HTMLTextAreaElement;
	textarea.value = typed;
	textarea.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
	);
	return waitForClose;
}

let fakeApp: ReturnType<typeof makeFakeApp>;

describe("GenericWideInputPrompt returns the user's input verbatim", () => {
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

	it("preserves a literal backslash-n in code (issue #799)", async () => {
		// #799's intent — keep a typed `\n` from corrupting code — is met without
		// doubling: a typed `\n` stays literal (not "\\n", not a real newline) because
		// the substituted value is never linebreak-expanded downstream.
		const typed = 'let s = "aa\\nbb";';
		await expect(submitWideValue(typed)).resolves.toBe(typed);
	});

	it("is an identity transform like the single-line prompt (Windows path + real newline)", async () => {
		// Backslashes survive un-doubled ("C:\x", not "C:\\x") and a real newline
		// passes through, so the same {{VALUE}} token stores identical bytes whether
		// the user is on the wide or single-line prompt.
		await expect(submitWideValue("C:\\temp\nC:\\x")).resolves.toBe(
			"C:\\temp\nC:\\x",
		);
	});
});
