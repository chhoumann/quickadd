import { describe, expect, it, vi } from "vitest";

// FormatPreviewField -> formatter graph pulls obsidian-dataview's CJS require.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import { flushSync } from "svelte";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { CaptureChoiceBuilder } from "./captureChoiceBuilder";

const plugin = {
	getTemplateFiles: () => [],
	settings: { choices: [] },
} as unknown as QuickAdd;

function openBuilder() {
	return new CaptureChoiceBuilder(
		new App(),
		new CaptureChoice("Capture under test"),
		plugin,
	);
}

// #1545: the builder saves on close by any route, but nothing said so and there
// was no completion affordance — the last row was "Icon" and then the modal
// simply ended.
describe("choice builder autosave footer", () => {
	it("states the autosave contract and closes on Done", () => {
		const modal = openBuilder();

		const footer = modal.modalEl.querySelector(
			".qa-builder-footer",
		) as HTMLElement;
		expect(footer).not.toBeNull();
		expect(footer.textContent).toContain(
			"Changes to this choice are saved automatically",
		);

		// Pinned outside the scrolling content, next to it — the doubt is not
		// confined to the bottom of a long form.
		expect(modal.contentEl.querySelector(".qa-builder-footer")).toBeNull();
		expect(footer.parentElement).toBe(modal.modalEl);
		expect(modal.containerEl.classList.contains("qa-choice-builder")).toBe(true);

		const done = footer.querySelector("button") as HTMLButtonElement;
		expect(done.textContent).toBe("Done");
		const close = vi.spyOn(modal, "close").mockImplementation(() => {});
		done.click();
		expect(close).toHaveBeenCalledTimes(1);
	});

	// The footer's claim is only honest if closing really does persist the edits.
	it("resolves the edited choice when the modal closes", async () => {
		const modal = openBuilder();
		const input = modal.contentEl.querySelector(
			'input[placeholder="Daily/{{DATE}}.md"]',
		) as HTMLInputElement;
		input.value = "Daily/{{DATE}}.md";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();

		modal.onClose();

		const resolved = (await modal.waitForClose) as ICaptureChoice;
		expect(resolved.captureTo).toBe("Daily/{{DATE}}.md");
	});
});
