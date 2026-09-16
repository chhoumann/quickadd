import { vi } from "vitest";
import type * as Obsidian from "obsidian";
import type { App, Modal } from "obsidian";

export async function modalObsidianStub(noticeMessages?: string[]) {
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

	class Modal {
		containerEl = document.createElement("div");
		contentEl = document.createElement("div");
		scope = new Scope();
		constructor(_app: App) { this.containerEl.appendChild(this.contentEl); }
		open() {
			if (noticeMessages && "onOpen" in this && typeof this.onOpen === "function") this.onOpen();
		}
		close() {}
	}
	const { ButtonComponent, DropdownComponent, Setting: BaseSetting, TextAreaComponent, TextComponent: BaseTextComponent } =
		await vi.importActual<typeof Obsidian>("obsidian");
	class Setting extends BaseSetting {
		constructor(container: HTMLElement) {
			super(container);
			this.settingEl.classList.add("setting-item");
			this.nameEl.classList.add("setting-item-name");
		}
	}
	class TextComponent extends BaseTextComponent {
		setDisabled(disabled: boolean): this {
			this.inputEl.disabled = disabled;
			return this;
		}
	}

	return {
		ButtonComponent, DropdownComponent, Modal, Setting, TextAreaComponent, TextComponent, Scope,
		Notice: class { constructor(message: string) { noticeMessages?.push(message); } },
		debounce: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
	};
}

export function ensureObsidianDomPolyfills(): void {
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

export function modalButton(modal: Pick<Modal, "contentEl">, label = "Submit"): HTMLButtonElement {
	const button = Array.from(modal.contentEl.querySelectorAll("button"))
		.find((candidate) => candidate.textContent === label);
	if (!button) throw new Error(`Missing modal button: ${label}`);
	return button;
}
