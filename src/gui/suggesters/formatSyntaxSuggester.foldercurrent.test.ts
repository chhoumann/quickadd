import { describe, expect, it, beforeEach } from "vitest";
import { FormatSyntaxSuggester, FormatSyntaxToken } from "./formatSyntaxSuggester";

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

function suggestFor(
	value: string,
	suggestForFileNames = false,
	excludeTokens: FormatSyntaxToken[] = [],
): Promise<string[]> {
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
	const suggester = new FormatSyntaxSuggester(
		app,
		inputEl,
		plugin,
		suggestForFileNames,
		excludeTokens,
	);
	return suggester.getSuggestions(value).finally(() => suggester.destroy());
}

describe("FormatSyntaxSuggester {{foldercurrent}} (shared {{folder prefix)", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
	});

	it("offers {{foldercurrent}} in the contextual set (format bodies + Capture To field)", async () => {
		const s = await suggestFor("{{foldercurrent");
		expect(s).toContain("{{foldercurrent}}");
	});

	it("narrows to foldercurrent only once disambiguated by 'c' (contextual set)", async () => {
		const s = await suggestFor("{{folderc");
		expect(s).toContain("{{foldercurrent}}");
		// {{folder|name}} lives only in the file-name set, and no bare {{folder}}
		// completion should survive the 'c'.
		expect(s.some((x) => /^\{\{folder\}?\}?$/.test(x))).toBe(false);
	});

	it("offers both folder tokens at the ambiguous {{folder prefix in the file-name set", async () => {
		const s = await suggestFor("{{folder", true);
		expect(s).toContain("{{folder|name}}");
		expect(s).toContain("{{foldercurrent|name}}");
	});

	it("offers only the |name form in the file-name set (full-path nesting footgun)", async () => {
		const s = await suggestFor("{{folderc", true);
		expect(s).toContain("{{foldercurrent|name}}");
		expect(s).not.toContain("{{foldercurrent}}");
		expect(s).not.toContain("{{folder|name}}");
	});

	it("withholds the token when excluded (insert-after/before line-target fields)", async () => {
		// formatLocationString leaves {{foldercurrent}} literal in line selectors,
		// so those fields exclude it — no suggester/runtime mismatch.
		const s = await suggestFor("{{folderc", false, [
			FormatSyntaxToken.FolderCurrent,
		]);
		expect(s).not.toContain("{{foldercurrent}}");
		// Other contextual tokens are unaffected by the exclusion.
		const links = await suggestFor("{{linkc", false, [
			FormatSyntaxToken.FolderCurrent,
		]);
		expect(links).toContain("{{linkcurrent}}");
	});
});
