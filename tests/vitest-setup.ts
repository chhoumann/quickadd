// Global test setup for component tests.
// Adds jest-dom matchers (toBeInTheDocument, toHaveAttribute, ...) to expect().
import "@testing-library/jest-dom/vitest";

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
	};
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
	if (typeof p.createEl !== "function") {
		p.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
			this: Element | DocumentFragment,
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
			if (info.prepend) this.prepend(el);
			else this.appendChild(el);
			callback?.(el);
			return el;
		};
	}
	if (typeof p.createDiv !== "function") {
		p.createDiv = function createDiv(this: HTMLElement | DocumentFragment, options?: DomElementInfo | string) {
			return this.createEl("div", options);
		};
	}
	if (typeof p.createSpan !== "function") {
		p.createSpan = function createSpan(this: HTMLElement | DocumentFragment, options?: DomElementInfo | string) {
			return this.createEl("span", options);
		};
	}
}

installObsidianDomHelpers(window);
