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
	};
	if (typeof p.setCssStyles !== "function") p.setCssStyles = setCssStyles;
	if (typeof p.setCssProps !== "function") p.setCssProps = setCssProps;
}
