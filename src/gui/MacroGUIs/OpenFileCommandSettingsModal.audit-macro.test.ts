import { testApp } from "../../../tests/helpers/settings/modalApp";
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/svelte";
import type { OpenStep } from "../../v3/model";
import { OpenFileCommandSettingsModal } from "./OpenFileCommandSettingsModal";


function getButton(
	modal: OpenFileCommandSettingsModal,
	text: string
): HTMLButtonElement {
	const button = Array.from(
		modal.containerEl.querySelectorAll<HTMLButtonElement>("button")
	).find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`${text} button not found`);
	return button;
}

const openStep = (): OpenStep => ({
	id: "open",
	name: "Open note: original.md",
	type: "open",
	note: "original.md",
	location: "reuse",
	direction: "vertical",
	mode: "default",
	focus: true,
});

describe("OpenFileCommandSettingsModal dismissal semantics", () => {
	beforeAll(() => {
		const modalProto = Object.getPrototypeOf(
			OpenFileCommandSettingsModal.prototype
		) as { onClose?: () => void };
		modalProto.onClose ??= function onClose() {};
	});

	it("discards edits (resolves null) when dismissed without Save (Esc/click-outside)", async () => {
		const modal = new OpenFileCommandSettingsModal(testApp(), openStep());
		const result = modal.waitForClose;

		// Simulate Esc / click-outside / X: Obsidian calls close() which fires onClose().
		modal.close();

		await expect(result).resolves.toBeNull();
	});

	it("commits the working copy when Save is clicked", async () => {
		const modal = new OpenFileCommandSettingsModal(testApp(), openStep());
		const result = modal.waitForClose;

		await fireEvent.click(getButton(modal, "Save"));

		const resolved = await result;
		expect(resolved).not.toBeNull();
		expect(resolved?.note).toBe("original.md");
	});

	it("saves the view picked under View", async () => {
		const modal = new OpenFileCommandSettingsModal(testApp(), openStep());
		const result = modal.waitForClose;
		// A row is its name, then its control.
		const view = Array.from(modal.contentEl.children)
			.find((row) => row.firstElementChild?.textContent === "View")
			?.querySelector("select");
		if (!view) throw new Error("View dropdown not found");
		expect(Array.from(view.options, (option) => option.textContent)).toEqual(["As saved", "Source mode", "Reading view", "Live Preview"]);

		view.value = "preview";
		await fireEvent.change(view);
		await fireEvent.click(getButton(modal, "Save"));

		expect(await result).toMatchObject({ note: "original.md", mode: "preview" });
	});
});
