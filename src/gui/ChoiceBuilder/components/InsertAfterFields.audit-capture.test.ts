import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import InsertAfterFields from "./InsertAfterFields.svelte";

const plugin = {
	getTemplateFiles: () => [],
	settings: { choices: [] },
} as unknown as QuickAdd;

function makeInsertAfter(
	overrides: Partial<ICaptureChoice["insertAfter"]> = {},
): ICaptureChoice["insertAfter"] {
	return {
		enabled: true,
		after: "## Tasks",
		insertAtEnd: false,
		considerSubsections: false,
		createIfNotFound: false,
		createIfNotFoundLocation: "top",
		inline: false,
		replaceExisting: false,
		blankLineAfterMatchMode: "auto",
		promptHeading: false,
		...overrides,
	};
}

function considerSubsectionsToggle(container: HTMLElement): HTMLElement {
	const item = Array.from(container.querySelectorAll(".setting-item")).find(
		(el) =>
			el.querySelector(".setting-item-name")?.textContent?.trim() ===
			"Consider subsections",
	);
	if (!item) throw new Error("Consider subsections setting not found");
	const toggle = item.querySelector('[role="switch"]');
	if (!toggle) throw new Error("Consider subsections toggle not found");
	return toggle as HTMLElement;
}

async function settle() {
	await tick();
	await tick();
}

describe("InsertAfterFields 'Consider subsections' gating (audit)", () => {
	it("disables the toggle when 'Insert at end of section' is off (the flag is inert)", async () => {
		const { container } = render(InsertAfterFields, {
			props: {
				insertAfter: makeInsertAfter({ insertAtEnd: false }),
				app: new App(),
				plugin,
			},
		});

		await settle();

		const toggle = considerSubsectionsToggle(container);
		expect(toggle.classList.contains("is-disabled")).toBe(true);
		expect(toggle.getAttribute("tabindex")).toBe("-1");
	});

	it("enables the toggle when 'Insert at end of section' is on (the flag is consulted)", async () => {
		const { container } = render(InsertAfterFields, {
			props: {
				insertAfter: makeInsertAfter({ insertAtEnd: true }),
				app: new App(),
				plugin,
			},
		});

		await settle();

		const toggle = considerSubsectionsToggle(container);
		expect(toggle.classList.contains("is-disabled")).toBe(false);
		expect(toggle.getAttribute("tabindex")).toBe("0");
	});
});
