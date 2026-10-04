import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { walkChoiceTree } from "../../src/migrations/helpers/choice-traversal";
import { normalizeImportedChoice } from "../../src/services/packageChoiceImport";
import type IChoice from "../../src/types/choices/IChoice";
import type IMultiChoice from "../../src/types/choices/IMultiChoice";
import type { QuickAddPackage } from "../../src/types/packages/QuickAddPackage";
import { lowerNode } from "../../src/v3/lower";
import { migrateChoice } from "../../src/v3/migrate";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";

/**
 * The "Journal entry" action of the daily-note-captures package, migrated to
 * v3 and lowered back, run by `quickadd:run` (ChoiceExecutor.executeWithOutcome)
 * next to the package's own v2 choice. Both must write the same daily note.
 */
const getContext = createQuickAddE2EHarness("v3-lowered-package-action");

const pkg = JSON.parse(readFileSync(
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/public/packages/daily-note-captures.quickadd.json"),
	"utf8",
)) as QuickAddPackage;
const folder = pkg.choices.find(({ choice }) => choice.type === "Multi")?.choice as IMultiChoice | undefined;
const journal = folder?.choices?.find((choice) => choice.name === "Journal entry");
if (!journal) throw new Error("The daily-note-captures package has no 'Journal entry' choice in its folder.");
walkChoiceTree(journal, normalizeImportedChoice);

let dailyNotesBefore: unknown;
beforeEach(async () => {
	dailyNotesBefore = await getContext().obsidian.dev.evalJson(`(() => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		return { enabled: plugin.enabled, options: plugin.instance.options };
	})()`);
});
afterEach(async () => {
	await getContext().obsidian.dev.evalJsonAsync(`(async () => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		const state = ${JSON.stringify(dailyNotesBefore)};
		if (state.enabled && !plugin.enabled) await plugin.enable(true);
		if (!state.enabled && plugin.enabled) await plugin.disable(true);
		plugin.instance.options = state.options;
		return true;
	})()`);
});

async function runInDailyFolder(name: string, choice: IChoice) {
	const { obsidian, plugin, sandbox } = getContext();
	const dailyFolder = sandbox.path(name);
	await obsidian.dev.evalJsonAsync(`(async () => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		if (!plugin.enabled) await plugin.enable(true);
		plugin.instance.options = { folder: ${JSON.stringify(dailyFolder)}, format: "YYYY-MM-DD", template: "" };
		return true;
	})()`);
	const notePath = `${name}/${await obsidian.dev.evalJson<string>(`window.moment().format("YYYY-MM-DD")`)}.md`;
	await seedVaultFile(obsidian, sandbox, notePath, "# Today\n\n## Journal\n- 08:00 first\n\n## Tasks\n");
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [choice];
	}));
	await plugin.reload({ waitUntilReady: true });
	const result = await obsidian.execJson<Record<string, unknown>>("quickadd:run", {
		id: choice.id,
		vars: JSON.stringify({ value: "Walked the dog" }),
		verify: "true",
	});
	const content = await sandbox.waitForContent(notePath, (text) => text.includes("Walked the dog"));
	return { result: { ok: result.ok, verified: result.verified, effect: result.effect }, content };
}

it("writes the same daily note as the v2 choice", async () => {
	const lowered = lowerNode(migrateChoice(journal).node);
	expect(lowered.type).toBe("Capture");

	const v2 = await runInDailyFolder("daily-v2", journal);
	const v3 = await runInDailyFolder("daily-v3", lowered);

	const time = /\d\d:\d\d Walked/;
	expect(v2.result).toEqual({ ok: true, verified: true, effect: "changed" });
	expect(v3.result).toEqual(v2.result);
	expect(v2.content).toMatch(/^# Today\n\n## Journal\n- 08:00 first\n- \d\d:\d\d Walked the dog\n\n## Tasks\n$/);
	expect(v3.content.replace(time, "HH:mm Walked")).toBe(v2.content.replace(time, "HH:mm Walked"));
});
