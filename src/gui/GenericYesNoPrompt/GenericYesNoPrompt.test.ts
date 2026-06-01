import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import GenericYesNoPrompt from "./GenericYesNoPrompt";

vi.mock("obsidian", () => {
	class Modal {
		containerEl: HTMLElement;
		contentEl: HTMLElement;
		titleEl: HTMLElement;

		constructor(_app: App) {
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

		onClick(callback: () => void): this {
			this.buttonEl.addEventListener("click", callback);
			return this;
		}

		setWarning(): this {
			return this;
		}
	}

	return { ButtonComponent, Modal };
});

function installObsidianElementHelpers(): void {
	const proto = HTMLElement.prototype as unknown as {
		addClass?: (this: HTMLElement, ...classes: string[]) => HTMLElement;
		createDiv?: (
			this: HTMLElement,
			options?: { cls?: string },
		) => HTMLDivElement;
		createEl?: (
			this: HTMLElement,
			tag: string,
			options?: { text?: string },
		) => HTMLElement;
		empty?: (this: HTMLElement) => void;
	};

	proto.addClass ??= function (...classes: string[]) {
		this.classList.add(...classes);
		return this;
	};

	proto.createDiv ??= function (options?: { cls?: string }) {
		const div = document.createElement("div");
		if (options?.cls) div.className = options.cls;
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

installObsidianElementHelpers();

describe("GenericYesNoPrompt", () => {
	afterEach(() => {
		document.body.replaceChildren();
	});

	it.each([
		["Yes", "mousedown", true],
		["No", "mousedown", false],
		["Yes", "pointerdown", true],
		["No", "pointerdown", false],
	])(
		"prevents prompt button %s %s from reaching the editor before click submit",
		async (buttonText, eventName, expectedAnswer) => {
			const waitForClose = GenericYesNoPrompt.Prompt(
				{} as App,
				"Confirm",
				"Continue?",
			);
			const button = Array.from(document.querySelectorAll("button")).find(
				(buttonEl) => buttonEl.textContent === buttonText,
			);
			const editorPointerPress = vi.fn();
			document.body.addEventListener(eventName, editorPointerPress);

			const pointerPress = new Event(eventName, {
				bubbles: true,
				cancelable: true,
			});
			button?.dispatchEvent(pointerPress);

			expect(pointerPress.defaultPrevented).toBe(true);
			expect(editorPointerPress).not.toHaveBeenCalled();

			button?.click();

			await expect(waitForClose).resolves.toBe(expectedAnswer);
		},
	);
});
