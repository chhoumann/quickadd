import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import Toggle from "./Toggle.svelte";

describe("Toggle", () => {
	it("flips and reports the new value via onchange on click", async () => {
		const onchange = vi.fn();
		const { container } = render(Toggle, {
			props: { checked: false, onchange },
		});
		const el = container.querySelector(".checkbox-container") as HTMLElement;
		expect(el.classList.contains("is-enabled")).toBe(false);
		await fireEvent.click(el);
		expect(onchange).toHaveBeenCalledWith(true);
		expect(el.classList.contains("is-enabled")).toBe(true);
	});

	it("does not flip when disabled", async () => {
		const onchange = vi.fn();
		const { container } = render(Toggle, {
			props: { checked: false, disabled: true, onchange },
		});
		const el = container.querySelector(".checkbox-container") as HTMLElement;
		await fireEvent.click(el);
		expect(onchange).not.toHaveBeenCalled();
		expect(el.classList.contains("is-enabled")).toBe(false);
	});
});
