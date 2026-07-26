import { FormatSyntaxSuggester } from "../../src/gui/suggesters/formatSyntaxSuggester";
import type { FormatSuggestContext } from "../../src/gui/suggesters/formatTokenRegistry";
import type { FormatTokenSuggestion } from "../../src/gui/suggesters/formatTokenRegistry";

/**
 * Minimal Obsidian DOM helpers the suggester's base class reaches for. The
 * vitest stub does not provide them, and each format-suggester spec used to
 * carry its own copy.
 */
export function ensureObsidianDomPolyfills(): void {
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

export interface SuggestOptions {
	context?: FormatSuggestContext;
	templatePaths?: string[];
	macroNames?: string[];
	globalVariables?: Record<string, string>;
}

/** Runs the real suggester against `value` with the caret at its end. */
export async function suggestRows(
	value: string,
	options: SuggestOptions = {},
): Promise<FormatTokenSuggestion[]> {
	ensureObsidianDomPolyfills();

	const app = {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: () => {}, popScope: () => {} },
	} as any;
	const plugin = {
		settings: {
			choices: (options.macroNames ?? []).map((name) => ({
				id: name,
				name,
				type: "Macro",
			})),
			globalVariables: options.globalVariables ?? {},
		},
		getTemplateFiles: () =>
			(options.templatePaths ?? []).map((path) => ({ path })),
	} as any;

	const inputEl = document.createElement("input");
	inputEl.value = value;
	inputEl.selectionStart = value.length;
	inputEl.selectionEnd = value.length;

	const suggester = new FormatSyntaxSuggester(
		app,
		inputEl,
		plugin,
		options.context,
	);
	try {
		return await suggester.getSuggestions(value);
	} finally {
		suggester.destroy();
	}
}

/** The strings the rows would insert, in display order. */
export async function suggestInserts(
	value: string,
	options: SuggestOptions = {},
): Promise<string[]> {
	return (await suggestRows(value, options)).map((row) => row.insert);
}
