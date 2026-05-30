import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";

import IconButton from "./IconButton.svelte";

describe("IconButton", () => {
	it("renders a real <button> with the given accessible name", () => {
		const { getByLabelText } = render(IconButton, {
			props: { iconId: "trash-2", label: "Delete thing", onclick: () => {} },
		});
		const btn = getByLabelText("Delete thing");
		expect(btn.tagName).toBe("BUTTON");
		// type="button" so it never submits a surrounding form.
		expect(btn.getAttribute("type")).toBe("button");
	});

	it("fires onclick (and is keyboard operable as a native button)", async () => {
		const onclick = vi.fn();
		const { getByLabelText } = render(IconButton, {
			props: { iconId: "settings", label: "Configure", onclick },
		});
		await fireEvent.click(getByLabelText("Configure"));
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it("exposes toggle state via aria-pressed (not just the label)", () => {
		const { getByLabelText, rerender } = render(IconButton, {
			props: {
				iconId: "zap",
				label: "Command palette",
				ariaPressed: false,
				onclick: () => {},
			},
		});
		const btn = getByLabelText("Command palette");
		expect(btn.getAttribute("aria-pressed")).toBe("false");

		rerender({
			iconId: "zap",
			label: "Command palette",
			ariaPressed: true,
			onclick: () => {},
		});
		expect(btn.getAttribute("aria-pressed")).toBe("true");
		expect(btn.classList.contains("is-pressed")).toBe(true);
	});

	it("omits aria-pressed/aria-haspopup when not provided", () => {
		const { getByLabelText } = render(IconButton, {
			props: { iconId: "copy", label: "Duplicate", onclick: () => {} },
		});
		const btn = getByLabelText("Duplicate");
		expect(btn.hasAttribute("aria-pressed")).toBe(false);
		expect(btn.hasAttribute("aria-haspopup")).toBe(false);
	});

	it("advertises a popup when ariaHasPopup is set (More-options button)", () => {
		const { getByLabelText } = render(IconButton, {
			props: {
				iconId: "more-vertical",
				label: "More options",
				ariaHasPopup: "menu",
				onclick: () => {},
			},
		});
		expect(getByLabelText("More options").getAttribute("aria-haspopup")).toBe("menu");
	});
});
