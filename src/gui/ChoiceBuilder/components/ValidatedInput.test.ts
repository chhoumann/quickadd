import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import ValidatedInput from "./ValidatedInput.svelte";

describe("ValidatedInput", () => {
	it("shows the required message on an empty value and clears it once filled", async () => {
		const { container } = render(ValidatedInput, {
			props: {
				value: "",
				required: true,
				requiredMessage: "Insert after text is required",
			},
		});
		await tick();
		await tick();
		const hint = container.querySelector(".qa-field-hint") as HTMLElement;
		expect(hint.textContent).toBe("Insert after text is required");

		const input = container.querySelector("input") as HTMLInputElement;
		input.value = "# Heading";
		await fireEvent.input(input);
		await tick();
		await tick();
		expect(hint.textContent).toBe("");
		expect(input.getAttribute("aria-invalid")).toBe("false");
	});

	it("reports the typed value via onChange", async () => {
		const onChange = vi.fn();
		const { container } = render(ValidatedInput, {
			props: { value: "", onChange },
		});
		const input = container.querySelector("input") as HTMLInputElement;
		input.value = "hello";
		await fireEvent.input(input);
		expect(onChange).toHaveBeenCalledWith("hello");
	});

	it("renders a textarea when inputKind=textarea", () => {
		const { container } = render(ValidatedInput, {
			props: { value: "x", inputKind: "textarea" },
		});
		expect(container.querySelector("textarea")).toBeTruthy();
	});

	it("keeps only the latest async validation result (staleness guard)", async () => {
		const validator = (v: string) =>
			Promise.resolve(v === "good" ? true : "Invalid value");
		const { container } = render(ValidatedInput, {
			props: { value: "", validator },
		});
		const input = container.querySelector("input") as HTMLInputElement;
		input.value = "bad";
		await fireEvent.input(input);
		input.value = "good";
		await fireEvent.input(input);
		await tick();
		await tick();
		const hint = container.querySelector(".qa-field-hint") as HTMLElement;
		expect(hint.textContent).toBe("");
	});
});
