import type { App } from "obsidian";
import { beforeAll, describe, expect, it, vi } from "vitest";

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

	it("Cancel rejects the promise (no input given)", async () => {
		const prompt = new GenericCheckboxPrompt(app, ["a", "b"], ["a"]);
		const promise = prompt.promise;

		buttonByText(prompt, "Cancel").dispatchEvent(
			new Event("click", { bubbles: true }),
		);

		await expect(promise).rejects.toBe("no input given.");
	});

	it("Submit resolves the selected items", async () => {
		const prompt = new GenericCheckboxPrompt(app, ["a", "b"], ["a"]);
		const promise = prompt.promise;

		buttonByText(prompt, "Submit").dispatchEvent(
			new Event("click", { bubbles: true }),
		);

		await expect(promise).resolves.toEqual(["a"]);
	});
});
