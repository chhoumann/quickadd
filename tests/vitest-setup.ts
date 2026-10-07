// Global test setup. Under jsdom it adds jest-dom matchers (toBeInTheDocument,
// toHaveAttribute, ...) to expect() and Obsidian's DOM helpers.
import { afterEach } from "vitest";

// Obsidian augments HTMLElement/SVGElement with `setCssStyles`/`setCssProps` at
// runtime; jsdom does not. Provide the helper subset used by these tests so plugin code that uses
// them (the idiomatic alternative to direct `.style.x = ...` assignment) runs
// under vitest. Guarded so a test that installs its own helpers still wins.
function setCssStyles(
	this: { style: CSSStyleDeclaration },
	styles: Partial<CSSStyleDeclaration>,
): void {
	Object.assign(this.style, styles);
}
function setCssProps(
	this: { style: CSSStyleDeclaration },
	props: Record<string, string>,
): void {
	for (const [key, value] of Object.entries(props)) {
		this.style.setProperty(key, value);
	}
}
export function installObsidianDomHelpers(window: Window): void {
	// Window omits the constructors exposed by each browser realm.
	const realm = window as Window & Pick<typeof globalThis, "Node" | "Element" | "HTMLElement" | "SVGElement">;
	for (const proto of [realm.HTMLElement.prototype, realm.SVGElement.prototype]) {
		if (typeof proto.setCssStyles !== "function") proto.setCssStyles = setCssStyles;
		if (typeof proto.setCssProps !== "function") proto.setCssProps = setCssProps;
	}
	const element = realm.Element.prototype;
	if (typeof element.addClass !== "function") {
		element.addClass = function addClass(this: Element, ...classes: string[]) {
			this.classList.add(...classes);
		};
	}
	const elementWithText = element as unknown as { setText?: unknown };
	if (typeof elementWithText.setText !== "function") {
		elementWithText.setText = function setText(this: Element, text: string) {
			this.textContent = text;
		};
	}
	if (typeof element.removeClass !== "function") {
		element.removeClass = function removeClass(this: Element, ...classes: string[]) {
			this.classList.remove(...classes);
		};
	}
	const p = realm.Node.prototype as unknown as {
		empty?: unknown;
		createDiv?: unknown;
		createSpan?: unknown;
		createEl?: unknown;
		instanceOf?: unknown;
		appendText?: unknown;
	};
	if (typeof p.appendText !== "function") {
		p.appendText = function appendText(this: Element, text: string) {
			this.append(text);
		};
	}
	if (typeof p.instanceOf !== "function") {
		p.instanceOf = function instanceOf(this: Node, type: { new (): unknown; name: string }) {
			if (this instanceof type) return true;
			const realm = this.ownerDocument?.defaultView;
			const constructor = realm && Reflect.get(realm, type.name);
			return typeof constructor === "function" && this instanceof constructor;
		};
	}
	if (typeof p.empty !== "function") {
		p.empty = function empty(this: Element) {
			this.textContent = "";
		};
	}
	function createEl<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		options: DomElementInfo | string = {},
		callback?: (el: HTMLElementTagNameMap[K]) => void,
	) {
		const el = realm.document.createElement(tag);
		const info = typeof options === "string" ? { cls: options } : options;
		if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
		if (info.text !== undefined) el.append(info.text);
		for (const [key, value] of Object.entries(info.attr ?? {})) {
			if (value !== null) el.setAttribute(key, String(value));
		}
		for (const key of ["title", "href", "type", "value", "placeholder"] as const) {
			if (info[key] !== undefined) el.setAttribute(key, info[key]);
		}
		callback?.(el);
		if (info.parent) {
			if (info.prepend) info.parent.insertBefore(el, info.parent.firstChild);
			else info.parent.appendChild(el);
		}
		return el;
	}
	if (typeof window.createEl !== "function") window.createEl = createEl;
	if (typeof window.createDiv !== "function") window.createDiv = (options, callback) => createEl("div", options, callback);
	if (typeof window.createSpan !== "function") window.createSpan = (options, callback) => createEl("span", options, callback);
	if (typeof window.createFragment !== "function") window.createFragment = (callback) => {
		const fragment = window.document.createDocumentFragment();
		callback?.(fragment);
		return fragment;
	};
	if (!("win" in realm.Node.prototype)) Object.defineProperty(realm.Node.prototype, "win", {
		configurable: true,
		get(this: Node) { return this.ownerDocument?.defaultView ?? window; },
	});
	if (typeof p.createEl !== "function") {
		p.createEl = function<K extends keyof HTMLElementTagNameMap>(this: Node, tag: K, options: DomElementInfo | string = {}, callback?: (el: HTMLElementTagNameMap[K]) => void) {
			return createEl(tag, { ...(typeof options === "string" ? { cls: options } : options), parent: this }, callback);
		};
	}
	if (typeof p.createDiv !== "function") {
		p.createDiv = function createDiv(this: HTMLElement | DocumentFragment, options?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void) {
			return this.createEl("div", options, callback);
		};
	}
	if (typeof p.createSpan !== "function") {
		p.createSpan = function createSpan(this: HTMLElement | DocumentFragment, options?: DomElementInfo | string, callback?: (el: HTMLSpanElement) => void) {
			return this.createEl("span", options, callback);
		};
	}
}

if (typeof window !== "undefined") {
	await import("@testing-library/jest-dom/vitest");
	installObsidianDomHelpers(window);
	// Obsidian's globals for the document and window that have focus.
	if (!("activeDocument" in globalThis)) {
		Object.defineProperty(globalThis, "activeDocument", { configurable: true, get: () => window.document });
	}
} else {
	// Engines catch and report errors, so a Node test that reaches the DOM can
	// still pass without running the path it names. Fail it instead.
	let firstRead: string | undefined;
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		get() {
			firstRead ??= new Error().stack;
			return undefined;
		},
	});
	afterEach(() => {
		const stack = firstRead;
		firstRead = undefined;
		if (stack) throw new Error(`This test reads \`document\`; add \`// @vitest-environment jsdom\` to its file.\n${stack}`);
	});
}
