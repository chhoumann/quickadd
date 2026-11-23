// @vitest-environment jsdom
import { testApp } from "../../../tests/helpers/settings/modalApp";
import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/svelte";
import { OpenFileCommand } from "../../types/macros/QuickCommands/OpenFileCommand";
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

function editFilePath(modal: OpenFileCommandSettingsModal, value: string): Promise<boolean> {
	const input = modal.contentEl.querySelector<HTMLInputElement>('input:not([type="checkbox"])');
	if (!input) throw new Error("File path input not found");
	return fireEvent.input(input, { target: { value } });
}

describe("OpenFileCommandSettingsModal dismissal semantics", () => {
	it("keeps the command unchanged and resolves null when dismissed without Save", async () => {
		const command = new OpenFileCommand("original.md");
		const modal = new OpenFileCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		await editFilePath(modal, "edited.md");
		// Esc, click-outside and the X all reach close(), which fires onClose().
		modal.close();

		await expect(result).resolves.toBeNull();
		expect(command).toMatchObject({ filePath: "original.md", name: "Open file: original.md" });
	});

	it("resolves the edited working copy on Save", async () => {
		const command = new OpenFileCommand("original.md");
		const modal = new OpenFileCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		await editFilePath(modal, "edited.md");
		await fireEvent.click(getButton(modal, "Save"));

		await expect(result).resolves.toMatchObject({ filePath: "edited.md", name: "Open file: edited.md" });
		expect(command.filePath).toBe("original.md");
	});
});
