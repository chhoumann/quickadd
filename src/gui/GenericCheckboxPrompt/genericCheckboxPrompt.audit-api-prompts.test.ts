import type { App } from "obsidian";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { UserCancelError } from "../../errors/UserCancelError";

// Mock obsidian with a local Modal/ButtonComponent/ToggleComponent so
// super.onClose() resolves (the shared stub's Modal omits onClose on the
// prototype, which super.onClose() needs). Mirrors GenericYesNoPrompt.test.ts.
vi.mock("obsidian", () => {
	class Modal {
		app: App;
		containerEl: HTMLElement;
		contentEl: HTMLElement;
		titleEl: HTMLElement;

		constructor(app: App) {
			this.app = app;
			this.containerEl = document.createElement("div");
			this.contentEl = document.createElement("div");
			this.titleEl = document.createElement("h1");
			this.containerEl.append(this.titleEl, this.contentEl);
			document.body.appendChild(this.containerEl);
		}

		open() {}

		close() {
			this.onClose();
		}

		onClose() {}
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

		onClick(callback: () => void): this {
			this.buttonEl.addEventListener("click", callback);
			return this;
		}
	}

	class ToggleComponent {
		toggleEl: HTMLInputElement;

		constructor(containerEl: HTMLElement) {
			this.toggleEl = document.createElement("input");
			this.toggleEl.type = "checkbox";
			containerEl.appendChild(this.toggleEl);
		}

		setValue(value: boolean): this {
			this.toggleEl.checked = value;
			return this;
		}

		setTooltip(): this {
			return this;
		}

		onChange(callback: (value: boolean) => void): this {
			this.toggleEl.addEventListener("change", () =>
				callback(this.toggleEl.checked),
			);
			return this;
		}
	}

	return { ButtonComponent, Modal, ToggleComponent };
});

const { default: GenericCheckboxPrompt } = await import("./genericCheckboxPrompt");

function installObsidianElementHelpers(): void {
	const proto = HTMLElement.prototype as unknown as {
		addClass?: (this: HTMLElement, ...classes: string[]) => void;
		createDiv?: (this: HTMLElement, cls?: string) => HTMLDivElement;
		createEl?: (
			this: HTMLElement,
			tag: string,
			options?: { text?: string },
		) => HTMLElement;
		empty?: (this: HTMLElement) => void;
	};
	proto.addClass ??= function (...classes: string[]) {
		this.classList.add(...classes);
	};
	proto.createDiv ??= function (cls?: string) {
		const div = document.createElement("div");
		if (cls) div.className = cls;
		this.appendChild(div);
		return div;
	};
	proto.createEl ??= function (tag: string, options?: { text?: string }) {
		const el = document.createElement(tag);
		if (options?.text) el.textContent = options.text;
		this.appendChild(el);
		return el;
	};
	proto.empty ??= function () {
		this.replaceChildren();
	};
}

beforeAll(() => {
	installObsidianElementHelpers();
	// Obsidian augments Array.prototype.contains; jsdom does not.
	const arrayProto = Array.prototype as unknown as {
		contains?: <T>(item: T) => boolean;
	};
	if (typeof arrayProto.contains !== "function") {
		arrayProto.contains = function contains<T>(this: T[], item: T): boolean {
			return this.includes(item);
		};
	}
});

function buttonByText(
	prompt: InstanceType<typeof GenericCheckboxPrompt>,
	text: string,
): HTMLButtonElement {
	const contentEl = (prompt as unknown as { contentEl: HTMLElement }).contentEl;
	const buttons = Array.from(
		contentEl.querySelectorAll<HTMLButtonElement>("button"),
	);
	const target = buttons.find((b) => b.textContent === text);
	if (!target) throw new Error(`button '${text}' not found`);
	return target;
}

function searchInput(
	prompt: InstanceType<typeof GenericCheckboxPrompt>,
): HTMLInputElement {
	const contentEl = (prompt as unknown as { contentEl: HTMLElement }).contentEl;
	const input = contentEl.querySelector<HTMLInputElement>(
		".qa-searchable-multi-select__search",
	);
	if (!input) throw new Error("search input not found");
	return input;
}

function visibleRows(
	prompt: InstanceType<typeof GenericCheckboxPrompt>,
): HTMLLabelElement[] {
	const contentEl = (prompt as unknown as { contentEl: HTMLElement }).contentEl;
	return Array.from(
		contentEl.querySelectorAll<HTMLLabelElement>(
			".qa-searchable-multi-select__option",
		),
	);
}

describe("GenericCheckboxPrompt header + cancel (audit: prompts-gui-checkbox-prompt)", () => {
	const app = {} as App;

	it("renders the optional header in titleEl", () => {
		const prompt = new GenericCheckboxPrompt(app, ["a", "b"], [], "Pick options");
		const titleEl = (prompt as unknown as { titleEl: HTMLElement }).titleEl;
		expect(titleEl.textContent).toBe("Pick options");
	});

	it("leaves titleEl empty when no header is given", () => {
		const prompt = new GenericCheckboxPrompt(app, ["a", "b"], []);
		const titleEl = (prompt as unknown as { titleEl: HTMLElement }).titleEl;
		expect(titleEl.textContent).toBe("");
	});

	it("renders an explicit Cancel button alongside Submit", () => {
		const prompt = new GenericCheckboxPrompt(app, ["a"], []);
		expect(() => buttonByText(prompt, "Submit")).not.toThrow();
		expect(() => buttonByText(prompt, "Cancel")).not.toThrow();
	});

	it("Cancel rejects the promise with a typed cancellation", async () => {
		const prompt = new GenericCheckboxPrompt(app, ["a", "b"], ["a"]);
		const promise = prompt.promise;

		buttonByText(prompt, "Cancel").dispatchEvent(
			new Event("click", { bubbles: true }),
		);

		await expect(promise).rejects.toBeInstanceOf(UserCancelError);
	});

	it("Submit resolves the selected items", async () => {
		const prompt = new GenericCheckboxPrompt(app, ["a", "b"], ["a"]);
		const promise = prompt.promise;

		buttonByText(prompt, "Submit").dispatchEvent(
			new Event("click", { bubbles: true }),
		);

		await expect(promise).resolves.toEqual(["a"]);
	});

	it("filters quickly without losing preselection or result ordering", async () => {
		const prompt = new GenericCheckboxPrompt(
			app,
			["Alpha", "Beta", "Gamma"],
			["Gamma"],
		);
		const promise = prompt.promise;
		const input = searchInput(prompt);
		input.value = "alpha";
		input.dispatchEvent(new Event("input", { bubbles: true }));

		expect(visibleRows(prompt)).toHaveLength(1);
		visibleRows(prompt)[0].click();
		buttonByText(prompt, "Submit").click();

		await expect(promise).resolves.toEqual(["Gamma", "Alpha"]);
	});

	it("uses one shared selection for duplicate option values", async () => {
		const prompt = new GenericCheckboxPrompt(app, ["Same", "Same"], []);
		const promise = prompt.promise;
		const rows = visibleRows(prompt);
		rows[0].click();

		const checkboxes = rows.map((row) =>
			row.querySelector<HTMLInputElement>('input[type="checkbox"]'),
		);
		expect(checkboxes.every((checkbox) => checkbox?.checked)).toBe(true);
		buttonByText(prompt, "Submit").click();
		await expect(promise).resolves.toEqual(["Same"]);
	});

	it("distinguishes an empty submission from cancellation", async () => {
		const submitted = new GenericCheckboxPrompt(app, [], []);
		const submittedPromise = submitted.promise;
		buttonByText(submitted, "Submit").click();
		await expect(submittedPromise).resolves.toEqual([]);

		const cancelled = new GenericCheckboxPrompt(app, [], []);
		const cancelledPromise = cancelled.promise;
		buttonByText(cancelled, "Cancel").click();
		await expect(cancelledPromise).rejects.toBeInstanceOf(UserCancelError);
	});
});
