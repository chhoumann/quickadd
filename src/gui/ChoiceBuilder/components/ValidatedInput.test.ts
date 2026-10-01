import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import ValidatedInput from "./ValidatedInput.svelte";

describe("ValidatedInput", () => {
	// Format strings like {{DATE:HH:mm}} got a red spellcheck underline.
	it.each(["text", "textarea"] as const)("turns spellcheck off for a %s field", (inputKind) => {
		const { container } = render(ValidatedInput, { props: { value: "- {{DATE:HH:mm}}", inputKind } });
		const field = container.querySelector(inputKind === "textarea" ? "textarea" : "input");
		expect(field?.getAttribute("spellcheck")).toBe("false");
	});

	// #2034: an untouched required field is not flagged yet.
	it("waits until the empty required field is left before showing the message", async () => {
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
		const input = container.querySelector("input") as HTMLInputElement;
		expect(hint.textContent).toBe("");
		expect(input.getAttribute("aria-invalid")).toBe("false");

		await fireEvent.blur(input);
		await tick();
		await tick();
		expect(hint.textContent).toBe("Insert after text is required");
		expect(input.getAttribute("aria-invalid")).toBe("true");
	});

	it("shows the required message once typed text is cleared, and clears it once filled", async () => {
		const { container } = render(ValidatedInput, {
			props: {
				value: "",
				required: true,
				requiredMessage: "Insert after text is required",
			},
		});
		const hint = container.querySelector(".qa-field-hint") as HTMLElement;
		const input = container.querySelector("input") as HTMLInputElement;
		const type = async (text: string) => {
			input.value = text;
			await fireEvent.input(input);
			await tick();
			await tick();
		};

		await type("#");
		await type("");
		expect(hint.textContent).toBe("Insert after text is required");

		await type("# Heading");
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

	it("renders a valid+message result as a neutral (non-error) hint", async () => {
		const validator = () => ({
			valid: true as const,
			message: "Contains format syntax — resolved at run time.",
		});
		const { container } = render(ValidatedInput, {
			props: { value: "Templates/{{value:type}}.md", validator },
		});
		await tick();
		await tick();
		const hint = container.querySelector(".qa-field-hint") as HTMLElement;
		const input = container.querySelector("input") as HTMLInputElement;
		expect(hint.textContent).toBe(
			"Contains format syntax — resolved at run time.",
		);
		// Neutral, not an error: the muted modifier is applied and the field is valid.
		expect(hint.classList.contains("qa-field-hint--neutral")).toBe(true);
		expect(input.classList.contains("is-invalid")).toBe(false);
		expect(input.getAttribute("aria-invalid")).toBe("false");
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
