import { afterEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { closeOpenPrompts, insertText, jsLiteral, POLL_OPTS, pressKey } from "./uiHelpers";

// #2235: a modal opened while a prompt is peeked must not cover the prompt
// once the user returns to it.
const getContext = createQuickAddE2EHarness("prompt-peek-stacking");

afterEach(async () => {
	await getContext().obsidian.dev.evalJson("window.__qaOtherModal?.close() ?? true");
	await closeOpenPrompts(getContext().obsidian);
});

// Page code cannot import "obsidian"; the settings modal's prototype chain
// reaches its Modal class.
const OPEN_OTHER_MODAL = `(() => {
	const Modal = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(app.setting))).constructor;
	const modal = new Modal(app);
	modal.titleEl.setText("New Event");
	modal.contentEl.createEl("textarea").style.height = "60vh";
	modal.open();
	window.__qaOtherModal = modal;
	return true;
})()`;

const FOCUSED_FIELD_IS_ON_TOP = `(() => {
	const field = document.activeElement;
	if (!field?.closest(".quickAddModal")) return "focus is not in a QuickAdd prompt";
	const rect = field.getBoundingClientRect();
	const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
	return hit === field ? true : "covered by " + (hit?.closest(".modal-container")?.querySelector(".modal-title")?.textContent || hit?.className);
})()`;

it.each([
	{ form: "one-page form", onePageInput: "always" },
	{ form: "single prompt", onePageInput: "never" },
] as const)("returns from a peek to the $form above a modal opened meanwhile", async ({ onePageInput }) => {
	const { obsidian, plugin, sandbox } = getContext();
	const note = await seedVaultFile(obsidian, sandbox, "Event.md", "# Event\n");

	const choice = new CaptureChoice("Peek stacking");
	choice.command = true;
	choice.captureToActiveFile = true;
	choice.onePageInput = onePageInput;
	choice.format = { enabled: true, format: "Person: {{VALUE:Name}}\n" };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJsonAsync(`(async () => {
		await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(${jsLiteral(note)}));
		return true;
	})()`);
	await obsidian.command(`quickadd:choice:${choice.id}`).run();
	await expect.poll(() => obsidian.dev.evalJson(FOCUSED_FIELD_IS_ON_TOP), POLL_OPTS).toBe(true);

	await obsidian.dev.evalJson(`(() => {
		[...document.querySelectorAll(".quickAddModal button")].find((b) => b.textContent === "Peek at note").click();
		return true;
	})()`);
	await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".qa-peek-chip"))'), POLL_OPTS).toBe(true);
	await obsidian.dev.evalJson(OPEN_OTHER_MODAL);
	await obsidian.dev.evalJson(`(() => {
		[...document.querySelectorAll(".qa-peek-chip button")].find((b) => b.textContent === "Return").click();
		return true;
	})()`);

	await expect.poll(() => obsidian.dev.evalJson(FOCUSED_FIELD_IS_ON_TOP), POLL_OPTS).toBe(true);
	await insertText(obsidian, "Ada");
	await pressKey(obsidian, "Enter", onePageInput === "always");
	await expect.poll(() => obsidian.dev.evalJsonAsync(`app.vault.adapter.read(${jsLiteral(note)})`), POLL_OPTS)
		.toBe("Person: Ada\n# Event\n");
	expect(await obsidian.dev.evalJson<boolean>("window.__qaOtherModal.containerEl.isConnected")).toBe(true);
});
