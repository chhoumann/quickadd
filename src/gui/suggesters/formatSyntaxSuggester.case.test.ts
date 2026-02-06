import { describe, expect, it, beforeEach } from "vitest";
import { FormatSyntaxSuggester } from "./formatSyntaxSuggester";

function ensureObsidianDomPolyfills(): void {
	(globalThis as any).createDiv ??= (cls?: string) => {
		const div = document.createElement("div");
		if (cls) div.className = cls;
		return div;
	};

	const proto = HTMLElement.prototype as any;

	proto.createDiv ??= function (arg?: string | { cls?: string }) {
		const div = document.createElement("div");
		if (typeof arg === "string") div.className = arg;
		else if (arg && typeof arg === "object" && typeof arg.cls === "string")
			div.className = arg.cls;
		this.appendChild(div);
		return div;
	};

	proto.empty ??= function () {
		this.replaceChildren();
		return this;
	};

	// Obsidian adds delegated event helpers; tests don't need behavior here.
	proto.on ??= function () {
		return this;
	};

	proto.detach ??= function () {
		this.remove();
	};

	proto.addClass ??= function (...classes: string[]) {
		this.classList.add(...classes);
		return this;
	};

	proto.removeClass ??= function (...classes: string[]) {
		this.classList.remove(...classes);
		return this;
	};

	proto.setAttr ??= function (name: string, value: string) {
		this.setAttribute(name, value);
		return this;
	};
}

describe("FormatSyntaxSuggester case style suggestions", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
	});

	it("suggests kebab when typing a |case: prefix", async () => {
		const app = {
			dom: { appContainerEl: document.body },
			keymap: { pushScope: () => {}, popScope: () => {} },
		} as any;
		const plugin = {
			settings: { choices: [], globalVariables: {} },
			getTemplateFiles: () => [],
		} as any;

		const inputEl = document.createElement("input");
		inputEl.value = "{{VALUE:title|case:k";
		inputEl.selectionStart = inputEl.value.length;
		inputEl.selectionEnd = inputEl.value.length;

		const suggester = new FormatSyntaxSuggester(app, inputEl, plugin);
		const suggestions = await suggester.getSuggestions(inputEl.value);
		expect(suggestions).toEqual(["kebab"]);
		suggester.destroy();
	});

	it("suggests all styles (including slug) when case fragment is empty", async () => {
		const app = {
			dom: { appContainerEl: document.body },
			keymap: { pushScope: () => {}, popScope: () => {} },
		} as any;
		const plugin = {
			settings: { choices: [], globalVariables: {} },
			getTemplateFiles: () => [],
		} as any;

		const inputEl = document.createElement("input");
		inputEl.value = "{{VALUE:title|case:";
		inputEl.selectionStart = inputEl.value.length;
		inputEl.selectionEnd = inputEl.value.length;

		const suggester = new FormatSyntaxSuggester(app, inputEl, plugin);
		const suggestions = await suggester.getSuggestions(inputEl.value);
		expect(suggestions).toContain("slug");
		expect(suggestions).toContain("kebab");
		expect(suggestions).toContain("snake");
		expect(suggestions).toContain("camel");
		expect(suggestions).toContain("pascal");
		expect(suggestions).toContain("title");
		expect(suggestions).toContain("lower");
		expect(suggestions).toContain("upper");
		suggester.destroy();
	});
});

