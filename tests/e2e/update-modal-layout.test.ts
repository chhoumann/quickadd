import { expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";

const getContext = createQuickAddE2EHarness("update-modal-layout");

// Upgrading from an old version fills the What's new modal with up to 100
// releases. The notes must scroll inside the modal so the Done footer stays in
// view (#635). The DOM mirrors UpdateModal: its contentEl carries the container
// class, followed by the notes and the footer.
it("keeps the Done footer in view when the release notes are long", async () => {
	const { obsidian } = getContext();
	const layout = await obsidian.dev.evalJson<{
		modalBottom: number;
		footerBottom: number;
		notesScrolls: boolean;
	}>(`(() => {
		const container = document.body.createDiv({ cls: "modal-container mod-dim" });
		try {
			container.createDiv({ cls: "modal-bg" });
			const modal = container.createDiv({ cls: "modal" });
			const content = modal.createDiv({ cls: "modal-content quickadd-update-modal-container" });
			const notes = content.createDiv({ cls: "quickadd-update-modal" });
			for (let i = 0; i < 300; i++) notes.createEl("p", { text: "Release note " + i });
			const footer = content.createDiv({ cls: "quickadd-update-modal-footer" });
			footer.createEl("button", { text: "Done" });
			return {
				modalBottom: modal.getBoundingClientRect().bottom,
				footerBottom: footer.getBoundingClientRect().bottom,
				notesScrolls: notes.scrollHeight > notes.clientHeight,
			};
		} finally {
			container.remove();
		}
	})()`);
	expect(layout.notesScrolls).toBe(true);
	expect(layout.footerBottom).toBeLessThanOrEqual(layout.modalBottom);
});
