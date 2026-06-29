import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "obsidian";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import GenericInputPrompt from "./GenericInputPrompt";
import GenericWideInputPrompt from "../GenericWideInputPrompt/GenericWideInputPrompt";

// The obsidian-stub Modal does not implement onOpen/onClose; the prompts call
// super.onOpen()/super.onClose(). Provide no-ops so construction and close do
// not throw. Guarded so a richer stub still wins.
const modalProto = Modal.prototype as unknown as {
	onOpen?: unknown;
	onClose?: unknown;
};
if (typeof modalProto.onOpen !== "function") modalProto.onOpen = () => {};
if (typeof modalProto.onClose !== "function") modalProto.onClose = () => {};

// Defensive HTMLElement polyfills (mirrors the VDate audit-cleanup test) so
// constructing the modal under jsdom does not throw.
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
