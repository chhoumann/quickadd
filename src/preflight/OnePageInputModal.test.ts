import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { FieldRequirement } from "./RequirementCollector";
import { OnePageInputModal } from "./OnePageInputModal";
import { buildValueVariableKey } from "src/utils/valueSyntax";

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
		controlEl: HTMLElement;
		private readonly infoEl: HTMLElement;
		private readonly nameEl: HTMLElement;
		private readonly descEl: HTMLElement;

		constructor(containerEl: HTMLElement) {
			const settingEl = document.createElement("div");
			this.infoEl = document.createElement("div");
			this.nameEl = document.createElement("div");
			this.descEl = document.createElement("div");
			this.controlEl = document.createElement("div");
			settingEl.appendChild(this.infoEl);
			settingEl.appendChild(this.controlEl);
			containerEl.appendChild(settingEl);
		}

		setName(name: string): this {
			this.nameEl.textContent = name;
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

vi.mock("src/gui/suggesters/FieldValueInputSuggest", () => ({
	FieldValueInputSuggest: class {},
}));

vi.mock("src/gui/suggesters/SuggesterInputSuggest", () => ({
	SuggesterInputSuggest: class {},
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

	proto.createEl ??= function (tag: string, options?: { text?: string }) {
		const el = document.createElement(tag);
		if (options?.text !== undefined) el.textContent = options.text;
		this.appendChild(el);
		return el;
	};

	proto.createDiv ??= function (options?: { cls?: string; text?: string }) {
		const div = document.createElement("div");
		if (options?.cls) div.className = options.cls;
		if (options?.text !== undefined) div.textContent = options.text;
		this.appendChild(div);
		return div;
	};
}

describe("OnePageInputModal", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
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
});
