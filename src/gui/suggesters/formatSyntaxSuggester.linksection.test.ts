import { describe, expect, it, beforeEach } from "vitest";
import { FormatSyntaxSuggester } from "./formatSyntaxSuggester";

// Minimal Obsidian DOM polyfills (same shape as formatSyntaxSuggester.case.test.ts).
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

function suggestFor(value: string): Promise<string[]> {
	const app = {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: () => {}, popScope: () => {} },
	} as any;
	const plugin = {
		settings: { choices: [], globalVariables: {} },
		getTemplateFiles: () => [],
	} as any;
	const inputEl = document.createElement("input");
	inputEl.value = value;
	inputEl.selectionStart = value.length;
	inputEl.selectionEnd = value.length;
	const suggester = new FormatSyntaxSuggester(app, inputEl, plugin);
	return suggester.getSuggestions(value).finally(() => suggester.destroy());
}

describe("FormatSyntaxSuggester {{linksection}} (shared {{link prefix)", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
	});

	it("offers both link tokens at the ambiguous {{link prefix", async () => {
		const s = await suggestFor("{{link");
		expect(s).toContain("{{linkcurrent}}");
		expect(s).toContain("{{linksection}}");
	});

	it("narrows to linkcurrent only once disambiguated by 'c'", async () => {
		const s = await suggestFor("{{linkc");
		expect(s).toContain("{{linkcurrent}}");
		expect(s).not.toContain("{{linksection}}");
	});

	it("narrows to linksection only once disambiguated by 's'", async () => {
		const s = await suggestFor("{{links");
		expect(s).toContain("{{linksection}}");
		expect(s).not.toContain("{{linkcurrent}}");
	});

	it("still completes the full {{linksection}} token", async () => {
		const s = await suggestFor("{{linksection");
		expect(s).toContain("{{linksection}}");
	});
});
