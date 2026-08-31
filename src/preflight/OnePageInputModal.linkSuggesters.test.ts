import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import { setQuickAddInstance } from "../quickAddInstance";
import type { FieldRequirement } from "./RequirementCollector";
import { OnePageInputModal } from "./OnePageInputModal";

const { fileSuggesters, tagSuggesters } = vi.hoisted(() => ({
	fileSuggesters: [] as Array<{
		inputEl: HTMLInputElement | HTMLTextAreaElement;
		options: unknown;
		destroy: ReturnType<typeof vi.fn>;
	}>,
	tagSuggesters: [] as Array<{
		inputEl: HTMLInputElement | HTMLTextAreaElement;
		options: unknown;
		destroy: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("src/gui/suggesters/fileSuggester", () => ({
	FileSuggester: class {
		destroy = vi.fn();

		constructor(
			_app: App,
			inputEl: HTMLInputElement | HTMLTextAreaElement,
			options?: unknown,
		) {
			fileSuggesters.push({ inputEl, options, destroy: this.destroy });
		}
	},
}));

vi.mock("src/gui/suggesters/tagSuggester", () => ({
	TagSuggester: class {
		destroy = vi.fn();

		constructor(
			_app: App,
			inputEl: HTMLInputElement | HTMLTextAreaElement,
			options?: unknown,
		) {
			tagSuggesters.push({ inputEl, options, destroy: this.destroy });
		}
	},
}));

vi.mock("src/gui/suggesters/FieldValueInputSuggest", () => ({
	FieldValueInputSuggest: class {},
}));

vi.mock("src/gui/suggesters/SuggesterInputSuggest", () => ({
	SuggesterInputSuggest: class {},
}));

vi.mock("src/gui/suggesters/FilePickerInputSuggest", () => ({
	FilePickerInputSuggest: class {
		destroy = vi.fn();
	},
}));

function makeFakeApp() {
	return {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: () => {}, popScope: () => {} },
		workspace: {
			containerEl: document.body,
			on: () => ({}),
			getActiveFile: () => null,
			getActiveViewOfType: () => undefined,
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

function ensureToggleClass(): void {
	const proto = HTMLElement.prototype as unknown as {
		toggleClass?: (cls: string, value: boolean) => void;
	};
	proto.toggleClass ??= function toggleClass(
		this: HTMLElement,
		cls: string,
		value: boolean,
	) {
		this.classList.toggle(cls, value);
	};
}

describe("OnePageInputModal link suggesters", () => {
	let fakeApp: ReturnType<typeof makeFakeApp>;

	beforeEach(() => {
		ensureToggleClass();
		fileSuggesters.length = 0;
		tagSuggesters.length = 0;
		fakeApp = makeFakeApp();
		setQuickAddInstance({
			app: fakeApp,
			registerEvent: () => {},
		} as unknown as QuickAdd);
	});

	afterEach(() => {
		for (const el of Array.from(document.body.children)) el.remove();
	});

	it("attaches file and tag suggesters only to text and textarea fields", () => {
		const requirements: FieldRequirement[] = [
			{ id: "title", label: "Title", type: "text" },
			{ id: "body", label: "Body", type: "textarea" },
			{ id: "count", label: "Count", type: "number" },
			{
				id: "status",
				label: "Status",
				type: "dropdown",
				options: ["open"],
			},
			{
				id: "rating",
				label: "Rating",
				type: "slider",
				sliderConfig: { min: 0, max: 10, step: 1 },
			},
			{ id: "field", label: "Field", type: "field-suggest" },
			{
				id: "pick",
				label: "Pick",
				type: "suggester",
				options: ["alpha"],
			},
			{
				id: "file",
				label: "File",
				type: "file-picker",
			},
		];

		const modal = new OnePageInputModal(fakeApp as never, requirements);
		modal.waitForClose.catch(() => undefined);
		const text = Array.from(
			modal.contentEl.querySelectorAll<HTMLInputElement>("input"),
		).find(
			(input) =>
				input.type === "text" &&
				!input.classList.contains("qa-onepage-file-picker__input"),
		);
		const textarea =
			modal.contentEl.querySelector<HTMLTextAreaElement>("textarea");

		expect(fileSuggesters.map(({ inputEl }) => inputEl)).toEqual([
			text,
			textarea,
		]);
		expect(tagSuggesters.map(({ inputEl }) => inputEl)).toEqual([
			text,
			textarea,
		]);
		expect(fileSuggesters.map(({ options }) => options)).toEqual([
			undefined,
			undefined,
		]);
		expect(tagSuggesters.map(({ options }) => options)).toEqual([
			{ refreshIndex: true },
			{ refreshIndex: false },
		]);

		modal.close();
	});

	it("names each free-text control from its field label", () => {
		const modal = new OnePageInputModal(fakeApp as never, [
			{ id: "title", label: "Title", type: "text" },
			{ id: "body", label: "Body", type: "textarea" },
		]);
		modal.waitForClose.catch(() => undefined);

		const text = Array.from(
			modal.contentEl.querySelectorAll<HTMLInputElement>("input"),
		).find((input) => input.type === "text");
		const textarea =
			modal.contentEl.querySelector<HTMLTextAreaElement>("textarea");
		const titleLabel = modal.contentEl.querySelector("#qa-onepage-label-title");
		const bodyLabel = modal.contentEl.querySelector("#qa-onepage-label-body");

		expect(titleLabel?.textContent).toBe("Title");
		expect(bodyLabel?.textContent).toBe("Body");
		expect(text?.getAttribute("aria-labelledby")).toBe("qa-onepage-label-title");
		expect(textarea?.getAttribute("aria-labelledby")).toBe(
			"qa-onepage-label-body",
		);

		modal.close();
	});

	it("destroys every attached file and tag suggester on close", () => {
		const modal = new OnePageInputModal(fakeApp as never, [
			{ id: "title", label: "Title", type: "text" },
			{ id: "body", label: "Body", type: "textarea" },
		]);
		modal.waitForClose.catch(() => undefined);

		modal.close();

		expect(fileSuggesters.map(({ destroy }) => destroy)).toHaveLength(2);
		expect(tagSuggesters.map(({ destroy }) => destroy)).toHaveLength(2);
		for (const { destroy } of [...fileSuggesters, ...tagSuggesters]) {
			expect(destroy).toHaveBeenCalledTimes(1);
		}
	});
});
