import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import GenericYesNoPrompt from "./GenericYesNoPrompt";

// Obsidian routes Esc, the close button and a click outside through the same
// Modal.close(), so the test hook onto the live instance is how a dismissal is
// reproduced faithfully without a real Obsidian.
const modals = vi.hoisted(() => ({ last: null as { close(): void } | null }));

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
			modals.last = this;
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

		setDestructive(): this {
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

function clickButton(text: string): void {
	const button = Array.from(document.querySelectorAll("button")).find(
		(buttonEl) => buttonEl.textContent === text,
	);
	button?.click();
}

/** Esc / the close button / a click outside — Obsidian closes the modal. */
function dismiss(): void {
	modals.last?.close();
}

describe("GenericYesNoPrompt", () => {
	afterEach(() => {
		document.body.replaceChildren();
		modals.last = null;
	});

	// The contract, in one place: walking away from the dialog is an answer, not
	// an error. It used to reject with a bare "No answer given." string, which
	// turned every cancelled confirmation into an unhandled rejection at the
	// call sites that (reasonably) just awaited a boolean (#1567).
	describe("contract", () => {
		it.each([
			["Yes", true],
			["No", false],
		])("Ask resolves %s as %s", async (buttonText, expected) => {
			const answer = GenericYesNoPrompt.Ask({} as App, "Confirm", "Continue?");
			clickButton(buttonText);
			await expect(answer).resolves.toBe(expected);
		});

		it("Ask resolves null when the dialog is dismissed", async () => {
			const answer = GenericYesNoPrompt.Ask({} as App, "Confirm", "Continue?");
			dismiss();
			await expect(answer).resolves.toBeNull();
		});

		it("Prompt resolves false when the dialog is dismissed", async () => {
			const answer = GenericYesNoPrompt.Prompt(
				{} as App,
				"Confirm",
				"Continue?",
			);
			dismiss();
			await expect(answer).resolves.toBe(false);
		});

		it.each([
			["Ask", () => GenericYesNoPrompt.Ask({} as App, "Confirm")],
			["Prompt", () => GenericYesNoPrompt.Prompt({} as App, "Confirm")],
		])("%s never rejects on dismissal", async (_name, open) => {
			const onRejected = vi.fn();
			const answer = open().catch(onRejected);
			dismiss();
			await answer;
			expect(onRejected).not.toHaveBeenCalled();
		});
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
