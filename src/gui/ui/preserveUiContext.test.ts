import { describe, expect, it, vi } from "vitest";
import { withPreservedUiContext } from "./preserveUiContext";

describe("withPreservedUiContext", () => {
	it("restores modal scroll, focus, and selection", () => {
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			cb(0);
			return 1;
		});

		document.body.innerHTML = `
			<div class="modal">
				<div class="modal-content" style="overflow:auto;max-height:120px;">
					<div id="root"></div>
				</div>
			</div>
		`;

		const root = document.getElementById("root") as HTMLDivElement;
		const modalContent = document.querySelector(
			".modal-content",
		) as HTMLDivElement;

		root.innerHTML = '<input data-qa-key="capture.path" value="abcdef" />';
		const input = root.querySelector("input") as HTMLInputElement;

		modalContent.scrollTop = 88;
		input.focus();
		input.setSelectionRange(2, 5);

		withPreservedUiContext(root, () => {
			root.innerHTML =
				'<input data-qa-key="capture.path" value="abcdef" />';
			modalContent.scrollTop = 0;
		});

		const restoredInput = root.querySelector("input") as HTMLInputElement;
		expect(modalContent.scrollTop).toBe(88);
		expect(document.activeElement).toBe(restoredInput);
		expect(restoredInput.selectionStart).toBe(2);
		expect(restoredInput.selectionEnd).toBe(5);
	});

	it("falls back to focus index when qa keys are absent", () => {
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			cb(0);
			return 1;
		});

		document.body.innerHTML = `
			<div class="modal">
				<div class="modal-content">
					<div id="root"></div>
				</div>
			</div>
		`;

		const root = document.getElementById("root") as HTMLDivElement;
		root.innerHTML = `
			<input value="one" />
			<input value="two" />
		`;

		const secondInput = root.querySelectorAll("input")[1] as HTMLInputElement;
		secondInput.focus();
		secondInput.setSelectionRange(1, 2);

		withPreservedUiContext(root, () => {
			root.innerHTML = `
				<input value="one" />
				<input value="two" />
			`;
		});

		const restoredSecondInput = root.querySelectorAll(
			"input",
		)[1] as HTMLInputElement;
		expect(document.activeElement).toBe(restoredSecondInput);
		expect(restoredSecondInput.selectionStart).toBe(1);
		expect(restoredSecondInput.selectionEnd).toBe(2);
	});
});
