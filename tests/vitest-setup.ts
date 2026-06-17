// Global test setup for component tests.
// Adds jest-dom matchers (toBeInTheDocument, toHaveAttribute, ...) to expect().
import "@testing-library/jest-dom/vitest";

// Obsidian augments HTMLElement/SVGElement with `setCssStyles`/`setCssProps` at
// runtime; jsdom does not. Provide faithful polyfills so plugin code that uses
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
for (const proto of [HTMLElement.prototype, SVGElement.prototype]) {
	const p = proto as unknown as {
		setCssStyles?: unknown;
		setCssProps?: unknown;
		addClass?: unknown;
		removeClass?: unknown;
		empty?: unknown;
		setText?: unknown;
		createDiv?: unknown;
		createEl?: unknown;
	};
	if (typeof p.setCssStyles !== "function") p.setCssStyles = setCssStyles;
	if (typeof p.setCssProps !== "function") p.setCssProps = setCssProps;
	if (typeof p.addClass !== "function") {
		p.addClass = function addClass(this: Element, ...classes: string[]) {
			this.classList.add(...classes);
		};
	}
	if (typeof p.removeClass !== "function") {
		p.removeClass = function removeClass(this: Element, ...classes: string[]) {
			this.classList.remove(...classes);
		};
	}
	if (typeof p.empty !== "function") {
		p.empty = function empty(this: Element) {
			this.textContent = "";
		};
	}
	if (typeof p.setText !== "function") {
		p.setText = function setText(this: Element, text: string) {
			this.textContent = text;
		};
	}
	if (typeof p.createDiv !== "function") {
		p.createDiv = function createDiv(
			this: Element,
			cls?: string | { cls?: string; text?: string },
		) {
			const div = document.createElement("div");
			if (typeof cls === "string") div.className = cls;
			if (typeof cls === "object") {
				if (cls.cls) div.className = cls.cls;
				if (cls.text) div.textContent = cls.text;
			}
			this.appendChild(div);
			return div;
		};
	}
	if (typeof p.createEl !== "function") {
		p.createEl = function createEl(
			this: Element,
			tag: string,
			options?: { cls?: string; text?: string; href?: string },
		) {
			const el = document.createElement(tag);
			if (options?.cls) el.className = options.cls;
			if (options?.text) el.textContent = options.text;
			if (options?.href) el.setAttribute("href", options.href);
			this.appendChild(el);
			return el;
		};
	}
}
