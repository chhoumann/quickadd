import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// #1877: the Capture format's Preview shows one line per line of the format.
const getContext = createQuickAddE2EHarness("format-preview-line-breaks");

const FORMAT = "### {{VALUE}}\n- [ ] Throw 📅 {{VDATE:due,YYYY-MM-DD}}\n\t- [ ] Glaze 📅 {{VALUE:due}}";

it("keeps the format's line breaks in the Capture format preview", async () => {
	const { obsidian, plugin } = getContext();
	const choice = new CaptureChoice("Format preview lines");
	// Builder autosave can outlive the harness's data restore, so never rely on
	// the name alone to find this run's choice.
	choice.name = `Format preview lines ${choice.id}`;
	choice.format = { enabled: true, format: FORMAT };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices.push(choice);
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson(`(() => { app.setting.open(); app.setting.openTabById("quickadd"); return true; })()`);
	try {
		const configure = JSON.stringify(`[aria-label="Configure ${choice.name}"]`);
		await expect.poll(() => obsidian.dev.evalJson(`(() => {
			const button = [...document.querySelectorAll(${configure})].find(b => b.getClientRects().length > 0);
			button?.click();
			return Boolean(button);
		})()`), POLL_OPTS).toBe(true);

		// Rendered lines, counted by the distinct tops of the preview text's boxes.
		await expect.poll(() => obsidian.dev.evalJson<{ text: string; lines: number } | null>(`(() => {
			const format = [...document.querySelectorAll('.captureChoiceBuilder .qa-field textarea')]
				.find(el => el.getClientRects().length > 0);
			const value = [...document.querySelectorAll(".captureChoiceBuilder .qa-preview-value")]
				.find(el => format && (format.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
			if (!value?.textContent) return null;
			const range = document.createRange();
			range.selectNodeContents(value);
			const tops = new Set([...range.getClientRects()].map(rect => Math.round(rect.top)));
			return { text: value.textContent, lines: tops.size };
		})()`), POLL_OPTS).toEqual({
			text: expect.stringMatching(/^### user input\n- \[ \] Throw 📅 \d{4}-\d{2}-\d{2}\n\t- \[ \] Glaze 📅 \d{4}-\d{2}-\d{2}$/),
			lines: 3,
		});
	} finally {
		await obsidian.dev.evalJson(`(() => {
			app.setting?.close?.();
			return true;
		})()`);
		await expect.poll(() => obsidian.dev.evalJson(`(() =>
			[...document.querySelectorAll(".captureChoiceBuilder")]
				.filter(builder => builder.getClientRects().length > 0).length
		)()`), POLL_OPTS).toBe(0);
	}
});
