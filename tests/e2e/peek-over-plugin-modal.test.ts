import { afterEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { closeOpenPrompts, insertText, jsLiteral, POLL_OPTS, pressKey } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("peek-over-plugin-modal");

const PROMPT_STATE = `(() => ({
	prompt: Boolean(document.querySelector(".qaInputPrompt:not(.qa-prompt-peek-hidden)")),
	peekVisible: Array.from(document.querySelectorAll(".qaInputPrompt .qa-peek-button"))
		.some((button) => button.getClientRects().length > 0),
	chip: Boolean(document.querySelector(".qa-peek-chip")),
}))()`;

afterEach(async () => {
	const { obsidian } = getContext();
	await closeOpenPrompts(obsidian);
	await obsidian.dev.evalJson(`(() => { window.__pluginModal?.close(); return true; })()`);
});

async function runFromNote(withPluginModal: boolean) {
	const { obsidian, plugin, sandbox } = getContext();
	const note = await seedVaultFile(obsidian, sandbox, "Event.md", "");
	const choice = new CaptureChoice("Name capture");
	choice.command = true;
	choice.captureToActiveFile = true;
	choice.onePageInput = "never";
	choice.format = { enabled: true, format: "Person: {{VALUE:Name}}" };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices.push(choice);
	});
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath(${jsLiteral(note)}));
		app.workspace.setActiveLeaf(leaf, { focus: true });
		leaf.view.editor.focus();
		if (${withPluginModal}) {
			// A dialog like Full Calendar's event editor, with its title field focused.
			const Modal = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(app.setting))).constructor;
			const modal = new Modal(app);
			if (!modal.contentEl) throw new Error("Modal lookup via app.setting's prototype chain broke");
			const input = modal.contentEl.createEl("input", { type: "text" });
			modal.open();
			input.focus();
			window.__pluginModal = modal;
		}
		app.commands.executeCommandById(${jsLiteral(`quickadd:choice:${choice.id}`)});
		return true;
	})()`);
	await expect.poll(() => obsidian.dev.evalJson<{ prompt: boolean }>(PROMPT_STATE).then((s) => s.prompt), POLL_OPTS).toBe(true);
	return note;
}

it("offers Peek on a prompt over the note", async () => {
	const { obsidian } = getContext();
	await runFromNote(false);
	expect(await obsidian.dev.evalJson(PROMPT_STATE)).toEqual({ prompt: true, peekVisible: true, chip: false });
});

it("keeps a prompt over another plugin's modal in front, without Peek", async () => {
	const { obsidian } = getContext();
	const note = await runFromNote(true);
	expect(await obsidian.dev.evalJson(PROMPT_STATE)).toEqual({ prompt: true, peekVisible: false, chip: false });

	await obsidian.dev.evalJson(`(() => {
		document.querySelector(".qaInputPrompt input").dispatchEvent(
			new KeyboardEvent("keydown", { key: "E", ctrlKey: true, metaKey: true, shiftKey: true, bubbles: true }),
		);
		return true;
	})()`);
	expect(await obsidian.dev.evalJson(PROMPT_STATE)).toEqual({ prompt: true, peekVisible: false, chip: false });

	await insertText(obsidian, "Ada");
	await pressKey(obsidian, "Enter");
	await expect.poll(() => obsidian.dev.evalJson(`(() => ({
		pluginModalOpen: window.__pluginModal.containerEl.isConnected,
		editor: app.workspace.activeLeaf.view.editor.getValue(),
	}))()`), POLL_OPTS).toEqual({ pluginModalOpen: true, editor: "Person: Ada" });
	expect(await obsidian.dev.evalJson<string>(`app.workspace.getActiveFile()?.path`)).toBe(note);
});
