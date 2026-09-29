import { expect, it } from "vitest";
import type { QuickAddPackage } from "../../src/types/packages/QuickAddPackage";
import { encodeToBase64 } from "../../src/utils/base64";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, jsLiteral, pressKey, typeInto, waitForElement } from "./uiHelpers";

// #1865: typing a file's Destination past a path that names a folder regrouped
// the row, which re-created it and dropped focus, and a folder destination
// failed the import with a raw EISDIR.
const getContext = createQuickAddE2EHarness("package-import-destination");

const DESTINATION = ".qa-package-dialog .qa-import-file-destination input";

it("keeps focus while you type a destination, and blocks a folder destination", async () => {
	const { obsidian, sandbox } = getContext();
	const notePath = sandbox.path("notes/run.md");
	// A folder the typed path passes through, like a vault's Scripts folder.
	await seedVaultFile(obsidian, sandbox, "Scripts/keep.md", "");
	const folder = sandbox.path("Scripts");
	const pkg: QuickAddPackage = {
		schemaVersion: 1,
		quickAddVersion: "2.29.0",
		createdAt: "2026-09-29T00:00:00.000Z",
		rootChoiceIds: [],
		choices: [],
		assets: [{
			kind: "template",
			originalPath: notePath,
			contentEncoding: "base64",
			content: encodeToBase64("# Note"),
		}],
	};

	const popout = await obsidian.dev.evalJson<boolean>("app.vault.getConfig('settingsPopoutWindow') ?? true");
	await obsidian.dev.evalJson("app.vault.setConfig('settingsPopoutWindow', false), true");
	const state = () => obsidian.dev.evalJson<{ focused: boolean; value: string; folder: boolean; importDisabled: boolean }>(`(() => {
		const input = document.querySelector(${jsLiteral(DESTINATION)});
		return {
			focused: document.activeElement === input,
			value: input.value,
			folder: Boolean(document.querySelector(".qa-import-file-folder")),
			importDisabled: document.querySelector(".qa-package-dialog .mod-cta").disabled,
		};
	})()`);

	try {
		await obsidian.dev.evalJson(`(() => { app.setting.open(); app.setting.openTabById("quickadd"); return true; })()`);
		await expect.poll(() => obsidian.dev.evalJson<boolean>(`(() => {
			const button = Array.from(document.querySelectorAll(".vertical-tab-content button"))
				.find((el) => el.textContent.includes("Import package"));
			button?.click();
			return Boolean(button);
		})()`), POLL_OPTS).toBe(true);
		await typeInto(obsidian, "#qa-import-json", JSON.stringify(pkg));
		await waitForElement(obsidian, DESTINATION);

		// Replace the default path, then type the rest one key at a time.
		const typed = `${folder}/run.md`;
		await typeInto(obsidian, DESTINATION, typed[0]);
		for (const char of typed.slice(1)) {
			await obsidian.exec("dev:cdp", { method: "Input.insertText", params: JSON.stringify({ text: char }) });
		}
		expect(await state()).toMatchObject({ focused: true, value: typed, folder: false, importDisabled: false });

		await typeInto(obsidian, DESTINATION, folder);
		await expect.poll(state, POLL_OPTS).toMatchObject({ focused: true, value: folder, folder: true, importDisabled: true });
	} finally {
		await pressKey(obsidian, "Escape");
		await obsidian.dev.evalJson("app.setting.close(); true");
		await obsidian.dev.evalJson(`app.vault.setConfig('settingsPopoutWindow', ${jsLiteral(popout)}), true`);
	}
});
