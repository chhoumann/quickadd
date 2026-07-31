import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { FieldRequirement } from "./RequirementCollector";
import { OnePageInputModal } from "./OnePageInputModal";
import { UserCancelError } from "../errors/UserCancelError";
import { buildValueVariableKey } from "src/utils/valueSyntax";

const { attachImagePasteHandlerMock } = vi.hoisted(() => ({
	attachImagePasteHandlerMock: vi.fn(() => ({
		isBusy: (): boolean => false,
		whenIdle: () => Promise.resolve(),
		detach: vi.fn(),
	})),
}));

const { filePickerSuggesters } = vi.hoisted(() => ({
	filePickerSuggesters: [] as Array<{
		onSelect: (option: {
			value: string;
			label: string;
			path: string;
			isCustom?: boolean;
		}) => void;
		destroy: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("src/gui/imagePasteHandler", () => ({
	attachImagePasteHandler: attachImagePasteHandlerMock,
}));

vi.mock("obsidian", () => {
	class Modal {
		containerEl: HTMLElement;
		contentEl: HTMLElement;

		constructor(_app: App) {
			this.containerEl = document.createElement("div");
			this.contentEl = document.createElement("div");
			this.containerEl.appendChild(this.contentEl);
		}

		open() {}
		close() {}
	}

	class DropdownComponent {
		selectEl: HTMLSelectElement;

		constructor(containerEl: HTMLElement) {
			this.selectEl = document.createElement("select");
			containerEl.appendChild(this.selectEl);
		}

		addOption(value: string, text: string): this {
			const option = document.createElement("option");
			option.value = value;
			option.textContent = text;
			this.selectEl.appendChild(option);
			return this;
		}

		setValue(value: string): this {
			this.selectEl.value = value;
			return this;
		}

		setDisabled(_disabled: boolean): this {
			return this;
		}

		onChange(cb: (value: string) => void): this {
			this.selectEl.addEventListener("change", () => cb(this.selectEl.value));
			return this;
		}
	}

	class TextComponent {
		inputEl: HTMLInputElement;

		constructor(containerEl: HTMLElement) {
			this.inputEl = document.createElement("input");
			containerEl.appendChild(this.inputEl);
		}

		setPlaceholder(value: string): this {
			this.inputEl.placeholder = value;
			return this;
		}

		setValue(value: string): this {
			this.inputEl.value = value;
			return this;
		}

		onChange(cb: (value: string) => void): this {
			this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
			return this;
		}

		setDisabled(disabled: boolean): this {
			this.inputEl.disabled = disabled;
			return this;
		}
	}

	class TextAreaComponent {
		inputEl: HTMLTextAreaElement;

		constructor(containerEl: HTMLElement) {
			this.inputEl = document.createElement("textarea");
			containerEl.appendChild(this.inputEl);
		}

		setPlaceholder(value: string): this {
			this.inputEl.placeholder = value;
			return this;
		}

		setValue(value: string): this {
			this.inputEl.value = value;
			return this;
		}

		onChange(cb: (value: string) => void): this {
			this.inputEl.addEventListener("input", () => cb(this.inputEl.value));
			return this;
		}
	}

	class ButtonComponent {
		buttonEl: HTMLButtonElement;

		constructor(containerEl: HTMLElement) {
			this.buttonEl = document.createElement("button");
			containerEl.appendChild(this.buttonEl);
		}

		setButtonText(text: string): this {
			this.buttonEl.textContent = text;
			return this;
		}

		setCta(): this {
			return this;
		}

		onClick(cb: () => void): this {
			this.buttonEl.addEventListener("click", cb);
			return this;
		}
	}

	class Setting {
		settingEl: HTMLElement;
		controlEl: HTMLElement;
		private readonly infoEl: HTMLElement;
		private readonly nameEl: HTMLElement;
		private readonly descEl: HTMLElement;

		constructor(containerEl: HTMLElement) {
			const settingEl = document.createElement("div");
			this.settingEl = settingEl;
			this.infoEl = document.createElement("div");
			this.nameEl = document.createElement("div");
			this.descEl = document.createElement("div");
			this.controlEl = document.createElement("div");
			settingEl.appendChild(this.infoEl);
			settingEl.appendChild(this.controlEl);
			containerEl.appendChild(settingEl);
		}

		setName(name: string | DocumentFragment): this {
			if (typeof name === "string") {
				this.nameEl.textContent = name;
			} else {
				this.nameEl.replaceChildren(name);
			}
			this.infoEl.appendChild(this.nameEl);
			return this;
		}

		setDesc(desc: string): this {
			this.descEl.textContent = desc;
			this.infoEl.appendChild(this.descEl);
			return this;
		}

		addButton(cb: (component: ButtonComponent) => void): this {
			cb(new ButtonComponent(this.controlEl));
			return this;
		}
	}

	return {
		DropdownComponent,
		Modal,
		Setting,
		TextAreaComponent,
		TextComponent,
		debounce: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
	};
});

vi.mock("src/gui/date-picker/datePicker", () => ({
	createDatePicker: () => ({ setSelectedIso: vi.fn() }),
}));

const { fieldSuggestConstructorArgs } = vi.hoisted(() => ({
	fieldSuggestConstructorArgs: [] as unknown[][],
}));

vi.mock("src/gui/suggesters/FieldValueInputSuggest", () => ({
	FieldValueInputSuggest: class {
		constructor(...args: unknown[]) {
			fieldSuggestConstructorArgs.push(args);
		}
	},
}));

vi.mock("src/gui/suggesters/SuggesterInputSuggest", () => ({
	SuggesterInputSuggest: class {},
}));

vi.mock("src/gui/suggesters/FilePickerInputSuggest", () => ({
	FilePickerInputSuggest: class {
		destroy = vi.fn();

		constructor(
			_app: App,
			_input: HTMLInputElement,
			_getOptions: () => unknown[],
			_isSelected: (value: string) => boolean,
			onSelect: (option: {
				value: string;
				label: string;
				path: string;
				isCustom?: boolean;
			}) => void,
		) {
			filePickerSuggesters.push({ onSelect, destroy: this.destroy });
		}
	},
}));

vi.mock("src/settingsStore", () => ({
	settingsStore: { getState: () => ({ dateAliases: {} }) },
}));

function ensureObsidianDomPolyfills(): void {
	const proto = HTMLElement.prototype as any;

	proto.empty ??= function () {
		this.replaceChildren();
		return this;
	};

	proto.addClass ??= function (...classes: string[]) {
		this.classList.add(...classes);
		return this;
	};

	proto.createEl ??= function (
		tag: string,
		options?: { text?: string; cls?: string },
	) {
		const el = document.createElement(tag);
		if (options?.text !== undefined) el.textContent = options.text;
		if (options?.cls) el.className = options.cls;
		this.appendChild(el);
		return el;
	};

	proto.createSpan ??= function (options?: { text?: string; cls?: string }) {
		return this.createEl("span", options);
	};

	proto.appendText ??= function (text: string) {
		this.appendChild(document.createTextNode(text));
		return this;
	};

	proto.createDiv ??= function (options?: { cls?: string; text?: string }) {
		const div = document.createElement("div");
		if (options?.cls) div.className = options.cls;
		if (options?.text !== undefined) div.textContent = options.text;
		this.appendChild(div);
		return div;
	};

	proto.setText ??= function (text: string) {
		this.textContent = text;
		return this;
	};

	proto.toggleClass ??= function (cls: string, on: boolean) {
		this.classList.toggle(cls, on);
		return this;
	};
}

describe("OnePageInputModal", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
		filePickerSuggesters.length = 0;
	});

	it("submits the first raw mapped dropdown option when untouched", async () => {
		const id = "#BF616A,#8CC570,#42A5F5";
		const requirements: FieldRequirement[] = [
			{
				id,
				label: "Color",
				type: "dropdown",
				options: ["#BF616A", "#8CC570", "#42A5F5"],
				displayOptions: ["red", "green", "blue"],
			},
		];

		const modal = new OnePageInputModal({} as App, requirements, new Map());
		const submitButton = Array.from(
			(modal as any).contentEl.querySelectorAll(
				"button",
			) as NodeListOf<HTMLButtonElement>,
		).find((button) => button.textContent === "Submit") as HTMLButtonElement;

		submitButton.click();

		await expect(modal.waitForClose).resolves.toEqual({
			[id]: "#BF616A",
		});
	});

	it("shows and submits the first FILE option by default", async () => {
		const id = "FILE:people";
		const requirements: FieldRequirement[] = [
			{
				id,
				label: "Related person",
				type: "file-picker",
				options: ["@file:People/Ada.md", "@file:People/Grace.md"],
				displayOptions: ["Ada", "Grace"],
				suggesterConfig: { multiSelect: false, allowCustomInput: false },
			},
		];

		const modal = new OnePageInputModal({} as App, requirements, new Map());
		const contentEl = (modal as any).contentEl as HTMLElement;
		expect(
			contentEl.querySelector(".qa-onepage-file-picker__chip-label")
				?.textContent,
		).toBe("Ada");
		expect(modal.fileSelections.get(id)).toEqual(["@file:People/Ada.md"]);
		expect(
			contentEl.querySelector(".qa-onepage-file-picker__input")?.getAttribute(
				"aria-label",
			),
		).toBe("Choose file for Related person");

		const submitButton = Array.from(
			contentEl.querySelectorAll("button"),
		).find((button) => button.textContent === "Submit") as HTMLButtonElement;
		submitButton.click();

		await expect(modal.waitForClose).resolves.toEqual({
			[id]: "@file:People/Ada.md",
		});
	});

	it("keeps multi FILE picks structured and ordered by the source list", () => {
		const id = "FILE:people|multi";
		const requirements: FieldRequirement[] = [
			{
				id,
				label: "Related people",
				type: "file-picker",
				options: [
					"@file:People/Doe, Jane.md",
					"@file:People/Grace.md",
				],
				displayOptions: ["Doe, Jane", "Grace"],
				suggesterConfig: { multiSelect: true, allowCustomInput: false },
			},
		];

		const modal = new OnePageInputModal({} as App, requirements, new Map());
		filePickerSuggesters[0].onSelect({
			value: "@file:People/Grace.md",
			label: "Grace",
			path: "People/Grace.md",
		});
		filePickerSuggesters[0].onSelect({
			value: "@file:People/Doe, Jane.md",
			label: "Doe, Jane",
			path: "People/Doe, Jane.md",
		});

		expect(modal.fileSelections.get(id)).toEqual([
			"@file:People/Doe, Jane.md",
			"@file:People/Grace.md",
		]);
		expect(
				Array.from(
					(modal as any).contentEl.querySelectorAll(
						".qa-onepage-file-picker__chip-label",
					) as NodeListOf<HTMLElement>,
				).map((element) => element.textContent),
		).toEqual(["Doe, Jane", "Grace"]);
	});

	it("removes the last FILE pick with Backspace on an empty search", () => {
		const id = "FILE:people|multi";
		const requirements: FieldRequirement[] = [
			{
				id,
				label: "Related people",
				type: "file-picker",
				options: ["@file:People/Ada.md"],
				displayOptions: ["Ada"],
				suggesterConfig: { multiSelect: true, allowCustomInput: false },
			},
		];

		const modal = new OnePageInputModal({} as App, requirements, new Map());
		filePickerSuggesters[0].onSelect({
			value: "@file:People/Ada.md",
			label: "Ada",
			path: "People/Ada.md",
		});
		const search = (modal as any).contentEl.querySelector(
			".qa-onepage-file-picker__input",
		) as HTMLInputElement;
		search.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));

		expect(modal.fileSelections.get(id)).toEqual([]);
	});

	it("returns a textarea field value verbatim, without doubling backslashes", async () => {
		// A |type:multiline ({{VALUE}}) field used to backslash-double its value here;
		// nothing downstream un-doubled it, so "C:\temp" became "C:\\temp" in the note
		// (and compounded with the |type:text YAML quoter). Keep it literal.
		const requirements: FieldRequirement[] = [
			{ id: "body", label: "Body", type: "textarea" },
		];
		const typed = 'C:\\temp\nlet s = "a\\nb";';

		const modal = new OnePageInputModal({} as App, requirements, new Map());
		const textarea = (modal as any).contentEl.querySelector(
			"textarea",
		) as HTMLTextAreaElement;
		textarea.value = typed;
		textarea.dispatchEvent(new Event("input", { bubbles: true }));

		const submitButton = Array.from(
			(modal as any).contentEl.querySelectorAll(
				"button",
			) as NodeListOf<HTMLButtonElement>,
		).find((button) => button.textContent === "Submit") as HTMLButtonElement;
		submitButton.click();

		await expect(modal.waitForClose).resolves.toEqual({ body: typed });
	});

	it("normalizes stale initial dropdown values to the first raw option", async () => {
		const id = "#BF616A,#8CC570,#42A5F5";
		const requirements: FieldRequirement[] = [
			{
				id,
				label: "Color",
				type: "dropdown",
				options: ["#BF616A", "#8CC570", "#42A5F5"],
				displayOptions: ["red", "green", "blue"],
			},
		];

		const initialValues = new Map<string, unknown>([[id, "stale"]]);
		const modal = new OnePageInputModal(
			{} as App,
			requirements,
			initialValues,
		);
		const submitButton = Array.from(
			(modal as any).contentEl.querySelectorAll(
				"button",
			) as NodeListOf<HTMLButtonElement>,
		).find((button) => button.textContent === "Submit") as HTMLButtonElement;

		submitButton.click();

		await expect(modal.waitForClose).resolves.toEqual({
			[id]: "#BF616A",
		});
	});

	it("renders bounded number fields and submits the normalized value", async () => {
		const requirements: FieldRequirement[] = [
			{
				id: "rating",
				label: "Rating",
				type: "number",
				defaultValue: "999",
				numericConfig: { min: 1, max: 10, step: 1 },
			},
		];

		const modal = new OnePageInputModal({} as App, requirements, new Map());
		const number = (modal as any).contentEl.querySelector(
			'input[type="number"]',
		) as HTMLInputElement;
		expect(number.min).toBe("1");
		expect(number.max).toBe("10");
		expect(number.step).toBe("1");
		expect(number.value).toBe("10");

		number.value = "-5";
		number.dispatchEvent(new Event("input", { bubbles: true }));

		const submitButton = Array.from(
			(modal as any).contentEl.querySelectorAll(
				"button",
			) as NodeListOf<HTMLButtonElement>,
		).find((button) => button.textContent === "Submit") as HTMLButtonElement;
		submitButton.click();

		await expect(modal.waitForClose).resolves.toEqual({ rating: "1" });
	});

	it("renders slider fields and submits the selected numeric value", async () => {
		const requirements: FieldRequirement[] = [
			{
				id: "rating",
				label: "Rating",
				type: "slider",
				defaultValue: "5",
				sliderConfig: { min: 1, max: 10, step: 1 },
			},
		];

		const modal = new OnePageInputModal({} as App, requirements, new Map());
		const range = (modal as any).contentEl.querySelector(
			'input[type="range"]',
		) as HTMLInputElement;
		const number = (modal as any).contentEl.querySelector(
			'input[type="number"]',
		) as HTMLInputElement;
		expect(range.min).toBe("1");
		expect(range.max).toBe("10");
		expect(range.step).toBe("1");
		expect(number.value).toBe("5");

		number.value = "999";
		number.dispatchEvent(new Event("input", { bubbles: true }));
		expect(range.value).toBe("10");
		expect(number.value).toBe("10");

		range.value = "7";
		range.dispatchEvent(new Event("input", { bubbles: true }));

		const submitButton = Array.from(
			(modal as any).contentEl.querySelectorAll(
				"button",
			) as NodeListOf<HTMLButtonElement>,
		).find((button) => button.textContent === "Submit") as HTMLButtonElement;
		submitButton.click();

		await expect(modal.waitForClose).resolves.toEqual({ rating: "7" });
	});

	it("lets negative slider values be typed through the numeric field", async () => {
		const requirements: FieldRequirement[] = [
			{
				id: "score",
				label: "Score",
				type: "slider",
				defaultValue: "0",
				sliderConfig: { min: -5, max: 5, step: 1 },
			},
		];

		const modal = new OnePageInputModal({} as App, requirements, new Map());
		const range = (modal as any).contentEl.querySelector(
			'input[type="range"]',
		) as HTMLInputElement;
		const number = (modal as any).contentEl.querySelector(
			'input[type="number"]',
		) as HTMLInputElement;

		number.value = "-";
		number.dispatchEvent(new Event("input", { bubbles: true }));
		expect(range.value).toBe("0");
		expect(number.value).toBe("");

		number.value = "-4";
		number.dispatchEvent(new Event("input", { bubbles: true }));
		expect(range.value).toBe("-4");
		expect(number.value).toBe("-4");

		const submitButton = Array.from(
			(modal as any).contentEl.querySelectorAll(
				"button",
			) as NodeListOf<HTMLButtonElement>,
		).find((button) => button.textContent === "Submit") as HTMLButtonElement;
		submitButton.click();

		await expect(modal.waitForClose).resolves.toEqual({ score: "-4" });
	});

	it("leaves untouched optional sliders empty when they have no default", async () => {
		const requirements: FieldRequirement[] = [
			{
				id: "rating",
				label: "Rating",
				type: "slider",
				optional: true,
				sliderConfig: { min: 1, max: 10, step: 1 },
			},
		];

		const modal = new OnePageInputModal({} as App, requirements, new Map());
		const number = (modal as any).contentEl.querySelector(
			'input[type="number"]',
		) as HTMLInputElement;
		expect(number.value).toBe("");

		const submitButton = Array.from(
			(modal as any).contentEl.querySelectorAll(
				"button",
			) as NodeListOf<HTMLButtonElement>,
		).find((button) => button.textContent === "Submit") as HTMLButtonElement;
		submitButton.click();

		await expect(modal.waitForClose).resolves.toEqual({ rating: "" });
	});

	// Regression: issue #1180 — One-page input dropped VALUE dropdown
	// selections for labeled tokens like {{VALUE:option-a,option-b|label:Pick one}},
	// resulting in an empty captured value instead of the first option.
	describe("labeled VALUE dropdown (issue #1180)", () => {
		it("submits the first option when the labeled dropdown is untouched", async () => {
			const id = buildValueVariableKey(
				"option-a,option-b",
				"Pick one",
				true,
			);
			const requirements: FieldRequirement[] = [
				{
					id,
					label: "Pick one",
					type: "dropdown",
					options: ["option-a", "option-b"],
				},
			];

			const modal = new OnePageInputModal(
				{} as App,
				requirements,
				new Map(),
			);
			const submitButton = Array.from(
				(modal as any).contentEl.querySelectorAll(
					"button",
				) as NodeListOf<HTMLButtonElement>,
			).find(
				(button) => button.textContent === "Submit",
			) as HTMLButtonElement;

			submitButton.click();

			await expect(modal.waitForClose).resolves.toEqual({
				[id]: "option-a",
			});
		});

		it("normalizes a stale empty initial value to the first option", async () => {
			const id = buildValueVariableKey(
				"option-a,option-b",
				"Pick one",
				true,
			);
			const requirements: FieldRequirement[] = [
				{
					id,
					label: "Pick one",
					type: "dropdown",
					options: ["option-a", "option-b"],
				},
			];

			const initialValues = new Map<string, unknown>([[id, ""]]);
			const modal = new OnePageInputModal(
				{} as App,
				requirements,
				initialValues,
			);
			const submitButton = Array.from(
				(modal as any).contentEl.querySelectorAll(
					"button",
				) as NodeListOf<HTMLButtonElement>,
			).find(
				(button) => button.textContent === "Submit",
			) as HTMLButtonElement;

			submitButton.click();

			await expect(modal.waitForClose).resolves.toEqual({
				[id]: "option-a",
			});
		});
	});

	// Regression: issue #1184 — field-suggest requirements are keyed with the
	// runtime "FIELD:" prefix; the modal must submit under that key while the
	// vault suggester receives the bare field specifier.
	describe("field-suggest (issue #1184)", () => {
		it("submits under the FIELD: id and passes the bare specifier to the suggester", async () => {
			fieldSuggestConstructorArgs.length = 0;
			const requirements: FieldRequirement[] = [
				{
					id: "FIELD:People",
					label: "People",
					type: "field-suggest",
				},
			];

			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const contentEl = (modal as any).contentEl as HTMLElement;
			const fieldInput = contentEl.querySelector(
				"input",
			) as HTMLInputElement;
			fieldInput.value = "Alice";
			fieldInput.dispatchEvent(new Event("input", { bubbles: true }));

			const submitButton = Array.from(
				contentEl.querySelectorAll(
					"button",
				) as NodeListOf<HTMLButtonElement>,
			).find(
				(button) => button.textContent === "Submit",
			) as HTMLButtonElement;
			submitButton.click();

			await expect(modal.waitForClose).resolves.toEqual({
				"FIELD:People": "Alice",
			});
			expect(fieldSuggestConstructorArgs).toHaveLength(1);
			expect(fieldSuggestConstructorArgs[0][2]).toBe("People");
		});
	});

	describe("optional fields (issue #1259)", () => {
		const clickSubmit = (modal: OnePageInputModal) => {
			const submitButton = Array.from(
				(modal as any).contentEl.querySelectorAll(
					"button",
				) as NodeListOf<HTMLButtonElement>,
			).find(
				(button) => button.textContent === "Submit",
			) as HTMLButtonElement;
			submitButton.click();
		};

		it("renders an (optional) badge for optional fields only", () => {
			const requirements: FieldRequirement[] = [
				{ id: "note", label: "note", type: "text", optional: true },
				{ id: "title", label: "title", type: "text" },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const badges = (modal as any).contentEl.querySelectorAll(
				".qa-onepage-optional-badge",
			);
			expect(badges).toHaveLength(1);
			expect(badges[0].textContent).toBe(" (optional)");
		});

		it("submits '' for an optional text field left empty", async () => {
			const requirements: FieldRequirement[] = [
				{ id: "note", label: "note", type: "text", optional: true },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			clickSubmit(modal);
			await expect(modal.waitForClose).resolves.toEqual({ note: "" });
		});

		it("adds a skip entry to optional dropdowns but keeps the first option preselected", async () => {
			const requirements: FieldRequirement[] = [
				{
					id: "low,med,high",
					label: "Priority",
					type: "dropdown",
					options: ["low", "med", "high"],
					optional: true,
				},
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const select = (modal as any).contentEl.querySelector(
				"select",
			) as HTMLSelectElement;

			expect(select.options[0].value).toBe("");
			expect(select.options[0].textContent).toBe("Skip (leave empty)");
			expect(select.options).toHaveLength(4);

			clickSubmit(modal);
			await expect(modal.waitForClose).resolves.toEqual({
				"low,med,high": "low",
			});
		});

		it("submits '' when the skip entry is chosen in an optional dropdown", async () => {
			const requirements: FieldRequirement[] = [
				{
					id: "low,med,high",
					label: "Priority",
					type: "dropdown",
					options: ["low", "med", "high"],
					optional: true,
				},
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const select = (modal as any).contentEl.querySelector(
				"select",
			) as HTMLSelectElement;
			select.value = "";
			select.dispatchEvent(new Event("change", { bubbles: true }));

			clickSubmit(modal);
			await expect(modal.waitForClose).resolves.toEqual({
				"low,med,high": "",
			});
		});

		it("submits '' for an optional date left blank", async () => {
			const requirements: FieldRequirement[] = [
				{
					id: "due",
					label: "due",
					type: "date",
					dateFormat: "YYYY-MM-DD",
					optional: true,
				},
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			clickSubmit(modal);
			await expect(modal.waitForClose).resolves.toEqual({ due: "" });
		});

		it("omits a required blank date so the sequential prompt still fires", async () => {
			const requirements: FieldRequirement[] = [
				{
					id: "due",
					label: "due",
					type: "date",
					dateFormat: "YYYY-MM-DD",
				},
				{ id: "note", label: "note", type: "text" },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			clickSubmit(modal);
			await expect(modal.waitForClose).resolves.toEqual({ note: "" });
		});

		it("omits an optional date whose text failed to parse (typo protection)", async () => {
			const requirements: FieldRequirement[] = [
				{
					id: "due",
					label: "due",
					type: "date",
					dateFormat: "YYYY-MM-DD",
					optional: true,
				},
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const dateInput = (modal as any).contentEl.querySelector(
				"input",
			) as HTMLInputElement;
			dateInput.value = "tomorow";
			dateInput.dispatchEvent(new Event("input", { bubbles: true }));

			clickSubmit(modal);
			await expect(modal.waitForClose).resolves.toEqual({});
		});

		it("does not resurrect the default when an optional date is cleared", async () => {
			const requirements: FieldRequirement[] = [
				{
					id: "due",
					label: "due",
					type: "date",
					dateFormat: "YYYY-MM-DD",
					defaultValue: "tomorrow",
					optional: true,
				},
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const dateInput = (modal as any).contentEl.querySelector(
				"input",
			) as HTMLInputElement;
			dateInput.value = "";
			dateInput.dispatchEvent(new Event("input", { bubbles: true }));

			clickSubmit(modal);
			await expect(modal.waitForClose).resolves.toEqual({ due: "" });
		});
	});

	describe("Esc settles the modal promise (issue #1259 rider)", () => {
		it("rejects with a typed cancellation when closed without submitting", async () => {
			const requirements: FieldRequirement[] = [
				{ id: "note", label: "note", type: "text" },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			modal.onClose();
			await expect(modal.waitForClose).rejects.toBeInstanceOf(UserCancelError);
		});

		it("does not double-settle after a submit", async () => {
			const requirements: FieldRequirement[] = [
				{ id: "note", label: "note", type: "text" },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const submitButton = Array.from(
				(modal as any).contentEl.querySelectorAll(
					"button",
				) as NodeListOf<HTMLButtonElement>,
			).find(
				(button) => button.textContent === "Submit",
			) as HTMLButtonElement;
			submitButton.click();
			modal.onClose();
			await expect(modal.waitForClose).resolves.toEqual({ note: "" });
		});
	});
});

describe("OnePageInputModal - image paste wiring (issue #1484)", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
		attachImagePasteHandlerMock.mockClear();
	});

	it("wires image paste for content text and textarea fields", () => {
		const requirements: FieldRequirement[] = [
			{ id: "body", label: "Body", type: "textarea" },
			{ id: "note", label: "Note", type: "text" },
		];

		new OnePageInputModal({} as App, requirements, new Map());

		expect(attachImagePasteHandlerMock).toHaveBeenCalledTimes(2);
	});

	it("never wires image paste for path-context fields", () => {
		const requirements: FieldRequirement[] = [
			{ id: "topic", label: "Topic", type: "text", pathContext: true },
			{ id: "body", label: "Body", type: "textarea" },
		];

		new OnePageInputModal({} as App, requirements, new Map());

		expect(attachImagePasteHandlerMock).toHaveBeenCalledTimes(1);
	});

	it("skips non-free-text field types", () => {
		const requirements: FieldRequirement[] = [
			{ id: "n", label: "N", type: "number" },
			{
				id: "pick",
				label: "Pick",
				type: "dropdown",
				options: ["a", "b"],
			},
		];

		new OnePageInputModal({} as App, requirements, new Map());

		expect(attachImagePasteHandlerMock).not.toHaveBeenCalled();
	});

	it("detaches all paste handlers on close", () => {
		const detach = vi.fn();
		attachImagePasteHandlerMock.mockReturnValueOnce({
			isBusy: () => false,
			whenIdle: () => Promise.resolve(),
			detach,
		});
		const requirements: FieldRequirement[] = [
			{ id: "body", label: "Body", type: "text" },
		];

		const modal = new OnePageInputModal({} as App, requirements, new Map());
		modal.waitForClose.catch(() => {}); // close-without-submit rejects
		modal.onClose();

		expect(detach).toHaveBeenCalled();
	});

	it("defers submit while a pasted image is still saving", async () => {
		let resolveIdle: () => void = () => {};
		const idle = new Promise<void>((resolve) => {
			resolveIdle = resolve;
		});
		let busy = true;
		attachImagePasteHandlerMock.mockReturnValueOnce({
			isBusy: () => busy,
			whenIdle: () => idle,
			detach: vi.fn(),
		});
		const requirements: FieldRequirement[] = [
			{ id: "body", label: "Body", type: "text" },
		];
		const modal = new OnePageInputModal({} as App, requirements, new Map());
		const submitButton = Array.from(
			(modal as any).contentEl.querySelectorAll(
				"button",
			) as NodeListOf<HTMLButtonElement>,
		).find((button) => button.textContent === "Submit") as HTMLButtonElement;

		submitButton.click();
		// Not settled yet: the submit deferred on the busy handle.
		let settled = false;
		void modal.waitForClose.then(() => {
			settled = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(settled).toBe(false);

		busy = false;
		resolveIdle();
		await expect(modal.waitForClose).resolves.toEqual({ body: "" });
	});
});

/**
 * The live preview block, which used to render only the text `computePreview`
 * returned - dropping the formatter's diagnostics entirely, so a name Obsidian
 * refuses was presented here in ordinary styling with nothing said (#1590).
 */
describe("OnePageInputModal preview block (#1590)", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
	});

	const requirement: FieldRequirement[] = [
		{ id: "title", label: "title", type: "text" },
	];

	/** Lets the preview's async pass settle. */
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	const previewEl = (modal: OnePageInputModal) =>
		(modal as any).contentEl.querySelector(
			".qa-onepage-preview",
		) as HTMLElement;

	it("renders each diagnostic with the builder's error styling", async () => {
		const modal = new OnePageInputModal(
			{} as App,
			requirement,
			undefined,
			() => [
				{
					label: "File name",
					text: "Bad: My Note",
					diagnostics: [
						{ severity: "error", message: "refused", kind: "path" },
					],
				},
			],
		);
		await settle();

		const block = previewEl(modal);
		// The block un-hides for a row (the inverse of the collapse below).
		expect(block.classList.contains("qa-hidden")).toBe(false);
		expect(block.querySelector(".qa-preview-val")?.textContent).toBe(
			"Bad: My Note",
		);
		const issue = block.querySelector(".qa-preview-issue");
		expect(issue).not.toBeNull();
		expect(issue?.classList.contains("qa-preview-issue--error")).toBe(true);
		// Severity in text, not colour alone (WCAG 1.4.1).
		expect(
			issue?.querySelector(".qa-visually-hidden")?.textContent,
		).toBe("Error: ");
		expect(issue?.textContent).toContain("refused");
		modal.close();
	});

	it("uses the builder's three-state label vocabulary (#1594)", async () => {
		const withDiagnostics = (
			diagnostics: { severity: string; message: string; kind?: string }[],
		) =>
			new OnePageInputModal({} as App, requirement, undefined, () => [
				{ label: "File name", text: "x", diagnostics } as never,
			]);

		const clean = withDiagnostics([]);
		await settle();
		expect(previewEl(clean).querySelector(".qa-preview-key")?.textContent).toBe(
			"File name:",
		);
		clean.close();

		// Resolved, but the vault will refuse it.
		const invalid = withDiagnostics([
			{ severity: "error", message: "refused", kind: "path" },
		]);
		await settle();
		expect(
			previewEl(invalid).querySelector(".qa-preview-key")?.textContent,
		).toBe("Won't be created:");
		invalid.close();

		// Could not resolve at all - and it wins when both are present.
		const unresolved = withDiagnostics([
			{ severity: "error", message: "refused", kind: "path" },
			{ severity: "error", message: "Template not found: Gone.md" },
		]);
		await settle();
		expect(
			previewEl(unresolved).querySelector(".qa-preview-key")?.textContent,
		).toBe("Unresolved:");
		unresolved.close();
	});

	it("collapses to nothing when the choice has no preview to show", async () => {
		// Every Capture, Macro and Multi choice, and every Template using the
		// default note-title prompt, rendered a padded tinted box containing the
		// single word "Preview".
		const modal = new OnePageInputModal(
			{} as App,
			requirement,
			undefined,
			() => [],
		);
		await settle();

		const block = previewEl(modal);
		expect(block.classList.contains("qa-hidden")).toBe(true);
		expect(block.textContent).toBe("");
		modal.close();
	});

	it("computes its FIRST preview from the prefilled answers", async () => {
		// display() used to fire updatePreviews above the renderField loop, and
		// this.result is only populated inside it - so the opening pass ran with
		// {} and flashed a stand-in over answers that were already known.
		const calls: Array<Record<string, unknown>> = [];
		const modal = new OnePageInputModal(
			{} as App,
			requirement,
			new Map([["title", "Prefilled"]]),
			(values) => {
				calls.push({ ...values });
				return [];
			},
		);
		await settle();

		expect(calls[0]).toEqual({ title: "Prefilled" });
		modal.close();
	});

	it("withholds an untouched required date, as submit() does", async () => {
		// A required blank date is OMITTED on submit so the sequential date prompt
		// still fires. Previewing it as answered-empty rendered a name the run
		// will never create (#1590).
		const calls: Array<Record<string, unknown>> = [];
		const modal = new OnePageInputModal(
			{} as App,
			[
				{ id: "title", label: "title", type: "text" },
				{ id: "due", label: "due", type: "date" },
			],
			undefined,
			(values) => {
				calls.push({ ...values });
				return [];
			},
		);
		await settle();

		expect(calls[0]).not.toHaveProperty("due");
		modal.close();
	});

	it("keeps an untouched OPTIONAL date, which is answered-empty", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const modal = new OnePageInputModal(
			{} as App,
			[{ id: "due", label: "due", type: "date", optional: true }],
			undefined,
			(values) => {
				calls.push({ ...values });
				return [];
			},
		);
		await settle();

		expect(calls[0]).toEqual({ due: "" });
		modal.close();
	});

	it("commits text and problems from the same pass, never a mix", async () => {
		// The 150ms debounce orders the STARTS of these passes, not their
		// completions, and a pass can read up to 25 templates.
		const deferred: Array<(rows: unknown) => void> = [];
		const modal = new OnePageInputModal(
			{} as App,
			requirement,
			undefined,
			() => new Promise((resolve) => deferred.push(resolve as never)),
		);
		// Second pass starts while the first is still pending.
		void (modal as any).updatePreviews();
		await settle();
		expect(deferred).toHaveLength(2);

		// The NEWER pass lands first...
		deferred[1]([
			{ label: "File name", text: "new", diagnostics: [] },
		] as never);
		await settle();
		// ...then the stale one, which must not overwrite it.
		deferred[0]([
			{
				label: "File name",
				text: "stale",
				diagnostics: [{ severity: "error", message: "stale problem" }],
			},
		] as never);
		await settle();

		const block = previewEl(modal);
		expect(block.querySelector(".qa-preview-val")?.textContent).toBe("new");
		expect(block.querySelector(".qa-preview-issue")).toBeNull();
		modal.close();
	});
});
