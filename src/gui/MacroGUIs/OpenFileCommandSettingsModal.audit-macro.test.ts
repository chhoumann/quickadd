import { beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { fireEvent } from "@testing-library/svelte";
import { OpenFileCommand } from "../../types/macros/QuickCommands/OpenFileCommand";
import { OpenFileCommandSettingsModal } from "./OpenFileCommandSettingsModal";

function testApp(): App {
	const app = new App() as App & {
		dom: { appContainerEl: HTMLElement };
		keymap: { pushScope: () => void; popScope: () => void };
	};
	app.dom = { appContainerEl: document.body };
	app.keymap = { pushScope: vi.fn(), popScope: vi.fn() };
	return app;
}

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

describe("OpenFileCommandSettingsModal dismissal semantics", () => {
	beforeAll(() => {
		const modalProto = Object.getPrototypeOf(
			OpenFileCommandSettingsModal.prototype
		) as { onClose?: () => void };
		modalProto.onClose ??= function onClose() {};
	});

	it("discards edits (resolves null) when dismissed without Save (Esc/click-outside)", async () => {
		const command = new OpenFileCommand("original.md");
		const modal = new OpenFileCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		// Simulate Esc / click-outside / X: Obsidian calls close() which fires onClose().
		modal.close();

		await expect(result).resolves.toBeNull();
	});

	it("commits the working copy when Save is clicked", async () => {
		const command = new OpenFileCommand("original.md");
		const modal = new OpenFileCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		await fireEvent.click(getButton(modal, "Save"));

		const resolved = await result;
		expect(resolved).not.toBeNull();
		expect(resolved?.filePath).toBe("original.md");
	});
});
