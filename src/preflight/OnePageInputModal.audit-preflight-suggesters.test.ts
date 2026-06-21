import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { FieldRequirement } from "./RequirementCollector";

const { noticeMessages } = vi.hoisted(() => ({
	noticeMessages: [] as string[],
}));

vi.mock("obsidian", () => {
	class Scope {
		private readonly handlers: Array<{
			mods: string[];
			key: string;
			cb: () => boolean;
		}> = [];

		register(mods: string[], key: string, cb: () => boolean) {
			this.handlers.push({ mods, key, cb });
		}

		trigger(mods: string[], key: string) {
			this.handlers
				.filter(
					(h) =>
						h.key === key &&
						h.mods.length === mods.length &&
						h.mods.every((m) => mods.includes(m)),
				)
				.forEach((h) => h.cb());
		}
	}

	class Notice {
		constructor(message: string) {
			noticeMessages.push(message);
		}
	}

	class Modal {
		containerEl: HTMLElement;
		contentEl: HTMLElement;
		scope: Scope;

		constructor(_app: App) {
			this.containerEl = document.createElement("div");
			this.contentEl = document.createElement("div");
			this.containerEl.appendChild(this.contentEl);
			this.scope = new Scope();
		}

		open() {
			(this as unknown as { onOpen?: () => void }).onOpen?.();
		}
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
		setDisabled(): this {
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
		setName(name: string | DocumentFragment): this {
			if (typeof name === "string") this.nameEl.textContent = name;
			else this.nameEl.replaceChildren(name);
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
		Notice,
		Setting,
		TextAreaComponent,
		TextComponent,
		Scope,
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

import { OnePageInputModal } from "./OnePageInputModal";

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
	proto.setText ??= function (text: string) {
		this.textContent = text;
		return this;
	};
	proto.toggleClass ??= function (cls: string, on: boolean) {
		this.classList.toggle(cls, on);
		return this;
	};
}

const findSubmit = (modal: OnePageInputModal): HTMLButtonElement =>
	Array.from(
		(modal as any).contentEl.querySelectorAll(
			"button",
		) as NodeListOf<HTMLButtonElement>,
	).find((button) => button.textContent === "Submit") as HTMLButtonElement;

describe("OnePageInputModal preflight-suggesters audit", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
		noticeMessages.length = 0;
	});

	// Finding: api-request-inputs — a required date with a typo would be silently
	// dropped as "" instead of blocking Submit; ensure Submit is blocked with a
	// notice and that fixing the value unblocks it.
	describe("required date parse-error gating", () => {
		it("blocks Submit and shows a notice while a required date fails to parse", async () => {
			const requirements: FieldRequirement[] = [
				{
					id: "due",
					label: "Due date",
					type: "date",
					dateFormat: "YYYY-MM-DD",
				},
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const dateInput = (modal as any).contentEl.querySelector(
				"input",
			) as HTMLInputElement;
			dateInput.value = "next fryday";
			dateInput.dispatchEvent(new Event("input", { bubbles: true }));

			let settled = false;
			void modal.waitForClose.then(() => (settled = true));

			findSubmit(modal).click();
			await Promise.resolve();

			expect(settled).toBe(false);
			expect(noticeMessages).toHaveLength(1);
			expect(noticeMessages[0]).toContain("Due date");
		});

		it("submits once the parse error is cleared (blocking is specific to the error)", async () => {
			const requirements: FieldRequirement[] = [
				{
					id: "due",
					label: "Due date",
					type: "date",
					dateFormat: "YYYY-MM-DD",
				},
				{ id: "note", label: "Note", type: "text" },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const dateInput = (modal as any).contentEl.querySelector(
				"input",
			) as HTMLInputElement;

			// Typo -> parse error -> Submit blocked.
			dateInput.value = "garbage";
			dateInput.dispatchEvent(new Event("input", { bubbles: true }));
			findSubmit(modal).click();
			expect(noticeMessages).toHaveLength(1);

			// Clearing the field removes the parse error; a required blank date is
			// omitted (so the sequential prompt can fire) and Submit proceeds.
			dateInput.value = "";
			dateInput.dispatchEvent(new Event("input", { bubbles: true }));
			findSubmit(modal).click();

			await expect(modal.waitForClose).resolves.toEqual({ note: "" });
		});
	});

	// Finding: prompts-gui-onepage-preflight-modal — the modal must auto-focus
	// the first field and submit on Mod+Enter without the mouse.
	describe("keyboard accessibility", () => {
		it("auto-focuses the first field on open", () => {
			const requirements: FieldRequirement[] = [
				{ id: "title", label: "Title", type: "text" },
				{ id: "body", label: "Body", type: "textarea" },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			// jsdom only updates activeElement for elements in the document.
			document.body.appendChild((modal as any).containerEl);
			(modal as any).open();

			const firstInput = (modal as any).contentEl.querySelector(
				"input",
			) as HTMLInputElement;
			expect(document.activeElement).toBe(firstInput);
		});

		it("submits on Mod+Enter via the modal scope", async () => {
			const requirements: FieldRequirement[] = [
				{ id: "title", label: "Title", type: "text" },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			(modal as any).open();

			const input = (modal as any).contentEl.querySelector(
				"input",
			) as HTMLInputElement;
			input.value = "Hello";
			input.dispatchEvent(new Event("input", { bubbles: true }));

			(modal as any).scope.trigger(["Mod"], "Enter");

			await expect(modal.waitForClose).resolves.toEqual({ title: "Hello" });
		});
	});
});
