import { beforeEach, describe, expect, it, vi } from "vitest";
import { installSkipAffordance } from "./utils";

function ensureObsidianDomPolyfills(): void {
	const proto = HTMLElement.prototype as any;
	proto.createDiv ??= function (options?: { cls?: string; text?: string }) {
		const div = document.createElement("div");
		if (options?.cls) div.className = options.cls;
		if (options?.text !== undefined) div.textContent = options.text;
		this.appendChild(div);
		return div;
	};
	proto.createEl ??= function (
		tag: string,
		options?: { cls?: string; text?: string },
	) {
		const el = document.createElement(tag);
		if (options?.cls) el.className = options.cls;
		if (options?.text !== undefined) el.textContent = options.text;
		this.appendChild(el);
		return el;
	};
}

// Finding: value-syntax-optional — optional option-list suggesters only had a
// keyboard Mod+Shift+Enter skip; mobile/pointer users had no Skip control.
// installSkipAffordance must render a visible, clickable Skip button when the
// modal exposes a modalEl.
describe("installSkipAffordance Skip button", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
	});

	it("renders a touch/mouse Skip button that invokes onSkip", () => {
		const modalEl = document.createElement("div");
		const onSkip = vi.fn();

		installSkipAffordance({ modalEl }, onSkip);

		const button = modalEl.querySelector(
			"button.qa-suggester-skip-button",
		) as HTMLButtonElement | null;
		expect(button).not.toBeNull();
		expect(button?.textContent).toBe("Skip (leave empty)");

		button?.click();
		expect(onSkip).toHaveBeenCalledTimes(1);
	});

	it("does not throw when the modal has no modalEl (stub suggester)", () => {
		const onSkip = vi.fn();
		expect(() => installSkipAffordance({}, onSkip)).not.toThrow();
		expect(onSkip).not.toHaveBeenCalled();
	});
});
