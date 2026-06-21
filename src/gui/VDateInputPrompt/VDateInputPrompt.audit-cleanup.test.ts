import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Modal } from "obsidian";
import type QuickAdd from "../../main";
import { setQuickAddInstance } from "../../quickAddInstance";
import { settingsStore } from "../../settingsStore";
import { InputPromptDraftStore } from "../../utils/InputPromptDraftStore";
import VDateInputPrompt from "./VDateInputPrompt";

// The obsidian-stub Modal does not implement onOpen/onClose; GenericInputPrompt
// calls super.onOpen() during open(). Provide a no-op base so construction (which
// opens the modal) does not throw. Guarded so a richer stub still wins.
const modalProto = Modal.prototype as unknown as { onOpen?: unknown };
if (typeof modalProto.onOpen !== "function") modalProto.onOpen = () => {};

// Obsidian augments HTMLElement at runtime; the shared vitest setup polyfills
// addClass/createDiv/etc. but not toggleClass (preview renderer) or setAttr (the
// date picker). Add them defensively (guarded) so constructing the modal under
// jsdom does not throw. Mirrors the setup file's pattern.
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

// Minimal fake app the prompt pulls in transitively via the FileSuggester/
// TagSuggester created in the GenericInputPrompt constructor.
function makeFakeApp() {
	return {
		workspace: { on: () => ({}) },
		metadataCache: {
			on: () => ({}),
			getTags: () => ({}),
			getFileCache: () => undefined,
			isUserIgnored: () => false,
		},
		vault: {
			on: () => ({}),
			getMarkdownFiles: () => [],
			getAllLoadedFiles: () => [],
			getFiles: () => [],
			getAbstractFileByPath: () => null,
		},
	};
}

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
