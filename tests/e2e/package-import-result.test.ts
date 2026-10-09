import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import type { QuickAddPackage } from "../../src/types/packages/QuickAddPackage";
import { encodeToBase64 } from "../../src/utils/base64";
import { createQuickAddE2EHarness } from "./e2eVault";
import { POLL_OPTS, pressKey, setVaultConfig, typeInto, waitForElement } from "./uiHelpers";

// #1880: after Import package, the result callout sat half hidden behind the
// footer, and Cancel stayed next to Close.
const getContext = createQuickAddE2EHarness("package-import-result");

it("shows the import result in view, with a single Close", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	// The import writes data.json through the plugin, which the harness does not
	// track. A no-op patch snapshots it so the per-test restore removes the choice.
	await plugin.data<{ choices: IChoice[] }>().patch(() => undefined);
	// Enough files that the review scrolls, as a real package's does.
	const assets = Array.from({ length: 6 }, (_, index) => ({
		kind: "template" as const,
		originalPath: sandbox.path(`notes/note-${index}.md`),
		contentEncoding: "base64" as const,
		content: encodeToBase64(`# Note ${index}`),
	}));
	const pkg: QuickAddPackage = {
		schemaVersion: 1,
		quickAddVersion: "2.29.0",
		createdAt: "2026-09-29T00:00:00.000Z",
		rootChoiceIds: [],
		choices: [],
		assets,
	};

	const popout = await obsidian.dev.evalJson<boolean>("app.vault.getConfig('settingsPopoutWindow') ?? true");
	await obsidian.dev.evalJson(`${setVaultConfig("settingsPopoutWindow", false)}, true`);
	try {
		await obsidian.dev.evalJson(`(() => { app.setting.open(); app.setting.openTabById("quickadd"); return true; })()`);
		await expect.poll(() => obsidian.dev.evalJson<boolean>(`(() => {
			const button = Array.from(document.querySelectorAll(".vertical-tab-content button"))
				.find((el) => el.textContent.includes("Import package"));
			button?.click();
			return Boolean(button);
		})()`), POLL_OPTS).toBe(true);
		await typeInto(obsidian, "#qa-import-json", JSON.stringify(pkg));
		await waitForElement(obsidian, ".qa-package-dialog .qa-import-file");

		// Import from the bottom of the review, where the button's user just was.
		await obsidian.dev.evalJson(`(() => {
			const body = document.querySelector(".qa-package-body");
			body.scrollTop = body.scrollHeight;
			document.querySelector(".qa-package-dialog .mod-cta").click();
			return true;
		})()`);

		await expect.poll(() => obsidian.dev.evalJson<{ inView: boolean; buttons: string[] } | null>(`(() => {
			const summary = document.querySelector(".qa-import-summary");
			if (!summary) return null;
			const body = document.querySelector(".qa-package-body").getBoundingClientRect();
			const rect = summary.getBoundingClientRect();
			// Scrolling snaps to device pixels, so a summary scrolled flush with the
			// edge can overhang it by a fraction of one.
			return {
				inView: rect.top >= body.top - 0.5 && rect.bottom <= body.bottom + 0.5,
				buttons: Array.from(document.querySelectorAll(".qa-package-dialog .modal-button-container button"), (b) => b.textContent.trim()),
			};
		})()`), POLL_OPTS).toEqual({ inView: true, buttons: ["Close"] });
	} finally {
		await pressKey(obsidian, "Escape");
		await obsidian.dev.evalJson("app.setting.close(); true");
		await obsidian.dev.evalJson(`${setVaultConfig("settingsPopoutWindow", popout)}, true`);
	}
});
