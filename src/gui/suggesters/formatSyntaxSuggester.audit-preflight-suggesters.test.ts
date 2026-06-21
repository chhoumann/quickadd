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

const makeApp = () =>
	({
		dom: { appContainerEl: document.body },
		keymap: { pushScope: () => {}, popScope: () => {} },
	}) as any;

const makePlugin = () =>
	({
		settings: { choices: [], globalVariables: {} },
		getTemplateFiles: () => [],
	}) as any;

async function suggestForFile(value: string, suggestForFileNames: boolean) {
	const inputEl = document.createElement("input");
	inputEl.value = value;
	inputEl.selectionStart = value.length;
	inputEl.selectionEnd = value.length;

	const suggester = new FormatSyntaxSuggester(
		makeApp(),
		inputEl,
		makePlugin(),
		suggestForFileNames,
	);
	const suggestions = await suggester.getSuggestions(value);
	suggester.destroy();
	return suggestions;
}

describe("FormatSyntaxSuggester file-name token gating", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
	});

	// Finding: format-core-file-options
	it("does NOT offer {{FILE:<folder>|optional}} in the file-name field", async () => {
		const suggestions = await suggestForFile("{{FILE", true);
		expect(suggestions).toContain("{{FILE:<folder>}}");
		expect(suggestions).not.toContain("{{FILE:<folder>|optional}}");
		// |link / |path stay gated too
		expect(suggestions).not.toContain("{{FILE:<folder>|link}}");
		expect(suggestions).not.toContain("{{FILE:<folder>|path}}");
	});

	it("still offers {{FILE:<folder>|optional}} outside the file-name field", async () => {
		const suggestions = await suggestForFile("{{FILE", false);
		expect(suggestions).toContain("{{FILE:<folder>|optional}}");
		expect(suggestions).toContain("{{FILE:<folder>|link}}");
		expect(suggestions).toContain("{{FILE:<folder>|path}}");
	});

	// Finding: format-file-filenamecurrent-token
	it("offers {{filenamecurrent}} in the file-name field", async () => {
		const suggestions = await suggestForFile("{{FILENAME", true);
		expect(suggestions).toContain("{{filenamecurrent}}");
	});
});
