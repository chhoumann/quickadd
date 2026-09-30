import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

// "Import" adds a choice and never replaces one: the CLI refuses it for a
// choice already in the vault, and the modal only offers it for new choices.
const getContext = createQuickAddE2EHarness("package-import-existing");

function packageWith(id: string, name: string, captureTo: string): string {
	return JSON.stringify({
		schemaVersion: 1,
		quickAddVersion: "2.30.0",
		createdAt: "2026-09-30T00:00:00.000Z",
		rootChoiceIds: [id],
		choices: [{ choice: { id, name, type: "Capture", captureTo }, pathHint: [name], parentChoiceId: null }],
		assets: [],
	});
}

const choiceById = (id: string) =>
	`(() => { const c = app.plugins.plugins.quickadd.settings.choices.find((choice) => choice.id === ${JSON.stringify(id)}); return c ? { name: c.name, captureTo: c.captureTo } : null; })()`;

it("refuses choices=import for a choice already in the vault and keeps it", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(() => undefined);
	const mine = await seedVaultFile(obsidian, sandbox, "mine.quickadd.json", packageWith("qa-e2e-existing", "Reading queue", "Queue.md"));
	const theirs = await seedVaultFile(obsidian, sandbox, "theirs.quickadd.json", packageWith("qa-e2e-existing", "Reading log", "Reading.md"));
	await obsidian.execJson("quickadd:package-import", { path: mine });

	const refused = await obsidian.execJson<{ ok: boolean; error?: string }>(
		"quickadd:package-import",
		{ path: theirs, choices: "import" },
	);

	expect(refused).toMatchObject({
		ok: false,
		error: 'Already in this vault: "Reading log". Import only adds new choices, so choose overwrite, duplicate or skip for it.',
	});
	expect(await obsidian.dev.evalJson(choiceById("qa-e2e-existing"))).toEqual({ name: "Reading queue", captureTo: "Queue.md" });
});

it("offers Overwrite, not Import, for a choice already in the vault", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(() => undefined);
	const mine = await seedVaultFile(obsidian, sandbox, "mine.quickadd.json", packageWith("qa-e2e-existing", "Reading queue", "Queue.md"));
	await obsidian.execJson("quickadd:package-import", { path: mine });

	const popout = await obsidian.dev.evalJson<boolean>("app.vault.getConfig('settingsPopoutWindow') ?? true");
	await obsidian.dev.evalJson("app.vault.setConfig('settingsPopoutWindow', false), true");
	try {
		await obsidian.dev.evalJson(`(() => { app.setting.open(); app.setting.openTabById("quickadd"); return true; })()`);
		await expect.poll(() => obsidian.dev.evalJson<boolean>(`(() => {
			const button = Array.from(document.querySelectorAll(".vertical-tab-content button"))
				.find((el) => el.textContent.includes("Import package"));
			button?.click();
			return Boolean(button);
		})()`), POLL_OPTS).toBe(true);
		await typeInto(obsidian, "#qa-import-json", packageWith("qa-e2e-existing", "Reading log", "Reading.md"));

		await expect.poll(() => obsidian.dev.evalJson<{ options: string[]; value: string } | null>(`(() => {
			const select = document.querySelector('.qa-import-choices select');
			return select ? { options: Array.from(select.options, (o) => o.value), value: select.value } : null;
		})()`), POLL_OPTS).toEqual({ options: ["overwrite", "duplicate", "skip"], value: "overwrite" });
	} finally {
		await pressKey(obsidian, "Escape");
		await obsidian.dev.evalJson("app.setting.close(); true");
		await obsidian.dev.evalJson(`app.vault.setConfig('settingsPopoutWindow', ${JSON.stringify(popout)}), true`);
	}
});
