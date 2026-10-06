import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";

describe.runIf(process.env.OBSIDIAN_E2E_TEMPLATER === "1")("Capture into a new note with Templater's new-file trigger", () => {
	const getContext = createQuickAddE2EHarness("templater-new-file-trigger");
	let folderTemplate = "";

	beforeAll(async () => {
		expect(await getContext().obsidian.dev.evalJson(
			`Boolean(app.plugins.plugins["templater-obsidian"]?.templater)`,
		)).toBe(true);
	});

	beforeEach(async () => {
		const { obsidian, sandbox } = getContext();
		// Created before the trigger is on, so Templater leaves the template alone.
		folderTemplate = await seedVaultFile(obsidian, sandbox, "templates/folder.md", "FT:<% tp.file.title %>\n");
		await obsidian.dev.evalJson(`(() => {
			const plugin = app.plugins.plugins["templater-obsidian"];
			window.__qaTriggerTest = { settings: structuredClone(plugin.settings), local: app.loadLocalStorage("templater-local-settings") };
			plugin.settings.trigger_on_file_creation_mode = "folder";
			plugin.settings.folder_templates = [{ folder: ${JSON.stringify(getContext().sandbox.path("with"))}, template: ${JSON.stringify(folderTemplate)} }];
			app.saveLocalStorage("templater-local-settings", { ...(window.__qaTriggerTest.local ?? {}), trigger_on_file_creation: true });
			return true;
		})()`);
	});

	afterEach(async () => {
		await getContext().obsidian.dev.evalJson(`(() => {
			const probe = window.__qaTriggerTest;
			if (probe) {
				app.plugins.plugins["templater-obsidian"].settings = probe.settings;
				app.saveLocalStorage("templater-local-settings", probe.local ?? null);
				delete window.__qaTriggerTest;
			}
			return true;
		})()`);
	});

	async function capture(folder: string) {
		const { obsidian, sandbox, plugin } = getContext();
		const choice = new CaptureChoice("Trigger capture");
		choice.onePageInput = "never";
		choice.captureTo = sandbox.path(`${folder}/note-${choice.id}.md`);
		choice.createFileIfItDoesntExist.enabled = true;
		choice.format = { enabled: true, format: "CAPTURED" };
		choice.prepend = true;
		await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices(data => { data.choices.push(choice); }));
		await plugin.reload({ waitUntilReady: true });
		return obsidian.dev.evalJsonAsync<{ ms: number; content: string }>(`(async () => {
			const start = performance.now();
			await app.plugins.plugins.quickadd.api.executeChoice(${JSON.stringify(choice.name)});
			const ms = performance.now() - start;
			return { ms, content: await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(choice.captureTo)})) };
		})()`);
	}

	// Templater waits 300 ms before it decides; QuickAdd used to wait up to 2.5 s more.
	it("adds the capture after the folder template without the old timeout", async () => {
		const { ms, content } = await capture("with");
		expect(content).toMatch(/^FT:.*\nCAPTURED$/);
		expect(ms).toBeLessThan(1500);
	});

	it("does not wait out a timeout when the folder has no template", async () => {
		const { ms, content } = await capture("without");
		expect(content).toBe("CAPTURED");
		expect(ms).toBeLessThan(1500);
	});
});
