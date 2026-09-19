import { expect, it } from "vitest";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import { UserScript } from "../../src/types/macros/UserScript";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, pressKey, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("multi-failure");

it("rejects a Multi run when its selected user script throws undefined", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const scriptPath = await seedVaultFile(
		obsidian, sandbox, "throw.js", "module.exports = async () => { throw undefined; };",
	);
	const macro = new MacroChoice("Failing script");
	macro.onePageInput = "never";
	macro.macro.commands.push(new UserScript("Failing script", scriptPath));
	const folder = new MultiChoice("Run failing script").addChoice(macro);
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [folder];
	});
	await plugin.reload({ waitUntilReady: true });
	try {
		await obsidian.dev.evalJson<boolean>(`(() => {
			window.__qaMultiFailure = { status: "pending" };
			void app.plugins.plugins.quickadd.api.executeChoice(${JSON.stringify(folder.name)}).then(
				() => { window.__qaMultiFailure = { status: "resolved" }; },
				(error) => { window.__qaMultiFailure = { status: "rejected", isError: error instanceof Error, message: error?.message }; },
			);
			return true;
		})()`);
		await waitForElement(obsidian, ".prompt .suggestion-item");
		await pressKey(obsidian, "Enter");
		await expect.poll(() => obsidian.dev.evalJson("window.__qaMultiFailure"), POLL_OPTS).toEqual({
			status: "rejected", isError: true, message: "undefined",
		});
	} finally {
		await obsidian.dev.evalJson<boolean>("delete window.__qaMultiFailure; true");
	}
});
