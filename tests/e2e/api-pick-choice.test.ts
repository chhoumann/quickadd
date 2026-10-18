import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { closeOpenPrompts, insertText, jsLiteral, POLL_OPTS, pressKey } from "./uiHelpers";

// Another plugin lets its user pick a QuickAdd choice, stores the id, and runs it
// later: the picker must run nothing, and the id must survive a rename.
const getContext = createQuickAddE2EHarness("api-pick-choice");

const SELECTED = ".qa-choice-suggester .suggestion-item.is-selected";

it("picks a nested choice without running it, then runs it by id after a rename", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const episode = await seedVaultFile(obsidian, sandbox, "Episode.md", "");
	const decoy = new CaptureChoice("Log book");
	decoy.captureTo = episode;
	const capture = new CaptureChoice("Log timestamp");
	capture.captureTo = episode;
	capture.format = { enabled: true, format: "- {{VALUE:timestamp}}" };
	const podcasts = new MultiChoice("Podcasts").addChoice(capture);
	await plugin.data<{ choices: IChoice[]; searchNestedChoices: boolean }>().patch((data) => {
		data.choices = [decoy, podcasts];
		// Pick mode searches nested choices whatever this says.
		data.searchNestedChoices = false;
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.exec("dev:errors", { clear: true });

	try {
		await obsidian.dev.evalJson<boolean>(`(() => {
			window.__qaPick = { status: "pending" };
			void app.plugins.plugins.quickadd.api.pickChoice().then(
				(choice) => { window.__qaPick = { status: "resolved", choice }; },
				(error) => { window.__qaPick = { status: "rejected", name: error?.name }; },
			);
			return true;
		})()`);
		await expect.poll(() => obsidian.dev.evalJson<boolean>(
			`Boolean(document.activeElement?.closest(".qa-choice-suggester"))`,
		), POLL_OPTS).toBe(true);

		await insertText(obsidian, "timestamp");
		await expect.poll(() => obsidian.dev.evalJson<string | null>(
			`document.querySelector(${jsLiteral(SELECTED)})?.textContent ?? null`,
		), POLL_OPTS).toBe("Log timestampPodcasts");
		await pressKey(obsidian, "Enter");

		await expect.poll(() => obsidian.dev.evalJson("window.__qaPick"), POLL_OPTS).toEqual({
			status: "resolved",
			choice: { id: capture.id, name: "Log timestamp", type: "Capture", path: ["Podcasts", "Log timestamp"] },
		});
		// Running the capture would open its {{VALUE:timestamp}} prompt at once.
		await obsidian.sleep(500);
		expect(await obsidian.dev.evalJson<boolean>(
			'Boolean(document.querySelector(".modal-container, .prompt"))',
		)).toBe(false);
		expect(await sandbox.read("Episode.md")).toBe("");

		capture.name = "Episode timestamp";
		await plugin.data<{ choices: IChoice[] }>().patch((data) => {
			data.choices = [decoy, podcasts];
		});
		await plugin.reload({ waitUntilReady: true });
		const renamed = await obsidian.dev.evalJsonAsync(`(async () => {
			const api = app.plugins.plugins.quickadd.api;
			await api.executeChoice({ id: ${jsLiteral(capture.id)} }, { timestamp: "[00:12:34]" });
			return api.getChoice({ id: ${jsLiteral(capture.id)} });
		})()`);

		expect(renamed).toEqual({
			id: capture.id,
			name: "Episode timestamp",
			type: "Capture",
			path: ["Podcasts", "Episode timestamp"],
		});
		await expect.poll(() => sandbox.read("Episode.md"), POLL_OPTS).toContain("- [00:12:34]");
		expect((await obsidian.execText("dev:errors")).trim()).toBe("No errors captured.");
	} finally {
		await obsidian.dev.evalJson<boolean>("delete window.__qaPick; true");
		await closeOpenPrompts(obsidian);
	}
});
