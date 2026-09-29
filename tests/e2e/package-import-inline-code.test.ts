import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness } from "./e2eVault";
import { clickAt, POLL_OPTS, pressKey, typeInto, waitForElement } from "./uiHelpers";

// #1912: the import review shows JavaScript written into a choice setting, counts
// viewing it like opening a bundled script, and says beside Import what is left.
const getContext = createQuickAddE2EHarness("package-import-inline-code");

type Gate = {
	reason: string | null;
	reasonInView: boolean | null;
	ackBelowFold: boolean;
	ackDisabled: boolean;
	importDisabled: boolean;
};

const GATE = `(() => {
	const dialog = document.querySelector(".qa-package-dialog");
	const body = dialog.querySelector(".qa-package-body").getBoundingClientRect();
	const reason = dialog.querySelector(".modal-button-container #qa-import-reason");
	const rect = reason?.getBoundingClientRect();
	const ack = dialog.querySelector("#qa-import-ack-checkbox");
	return {
		reason: reason ? reason.textContent.trim() : null,
		reasonInView: rect ? rect.width > 0 && rect.top >= 0 && rect.bottom <= innerHeight : null,
		ackBelowFold: ack.getBoundingClientRect().top >= body.bottom,
		ackDisabled: ack.disabled,
		importDisabled: dialog.querySelector(".mod-cta").disabled,
	};
})()`;

/** Scrolls `selector` into view and returns its centre, for a real click. */
function centreOf(selector: string, text?: string) {
	return `(() => {
		const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
			.find((e) => ${text === undefined ? "true" : `e.textContent.trim() === ${JSON.stringify(text)}`});
		el.scrollIntoView({ block: "center" });
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	})()`;
}

it("shows a choice's inline code and says beside Import what is left", async () => {
	const { obsidian, plugin } = getContext();
	// The import writes data.json through the plugin, which the harness does not
	// track. A no-op patch snapshots it so the per-test restore removes the choices.
	await plugin.data<{ choices: IChoice[] }>().patch(() => undefined);
	const format = "- {{DATE:HH:mm}} ```js quickadd return app.vault.getName()``` {{VALUE}}";
	const capture = (id: string, name: string, captureFormat: string) => ({
		choice: { id, name, type: "Capture", command: false, captureTo: "Inbox.md", format: { enabled: true, format: captureFormat } },
		pathHint: [name],
		parentChoiceId: null,
	});
	// Enough choices that the review scrolls, as a real package's does.
	const choices = [
		capture("qa-inline-log", "Log vault name", format),
		...Array.from({ length: 5 }, (_, index) => capture(`qa-inline-plain-${index}`, `Plain ${index}`, "- {{VALUE}}")),
	];
	const pkg = {
		schemaVersion: 1,
		quickAddVersion: "2.29.0",
		createdAt: "2026-09-29T00:00:00.000Z",
		rootChoiceIds: choices.map((entry) => entry.choice.id),
		choices,
		assets: [],
	};

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
		await typeInto(obsidian, "#qa-import-json", JSON.stringify(pkg));
		await waitForElement(obsidian, ".qa-package-dialog .qa-import-choices");
		await obsidian.dev.evalJson(`(() => { document.querySelector(".qa-package-body").scrollTop = 0; return true; })()`);

		// The checkbox is out of view, but the reason is beside the button.
		expect(await obsidian.dev.evalJson<Gate>(GATE)).toEqual({
			reason: "View 1 script above to import.",
			reasonInView: true,
			ackBelowFold: true,
			ackDisabled: true,
			importDisabled: true,
		});

		const viewCode = await obsidian.dev.evalJson<{ x: number; y: number }>(centreOf(".qa-import-choices button", "View code"));
		await clickAt(obsidian, viewCode.x, viewCode.y);
		await expect.poll(() => obsidian.dev.evalJson<string | null>(
			`document.querySelector(".qa-import-choice-code pre")?.textContent ?? null`,
		), POLL_OPTS).toBe(format);
		await expect.poll(() => obsidian.dev.evalJson<Gate>(GATE), POLL_OPTS).toMatchObject({
			reason: "Confirm the acknowledgement above to import.",
			ackDisabled: false,
			importDisabled: true,
		});

		const ack = await obsidian.dev.evalJson<{ x: number; y: number }>(centreOf("#qa-import-ack-checkbox"));
		await clickAt(obsidian, ack.x, ack.y);
		await expect.poll(() => obsidian.dev.evalJson<Gate>(GATE), POLL_OPTS).toMatchObject({
			reason: null,
			importDisabled: false,
		});

		const importButton = await obsidian.dev.evalJson<{ x: number; y: number }>(centreOf(".qa-package-dialog .mod-cta"));
		await clickAt(obsidian, importButton.x, importButton.y);
		// What you read is what was imported.
		await expect.poll(() => obsidian.dev.evalJson<string | null>(
			`app.plugins.plugins.quickadd.settings.choices.find((choice) => choice.id === "qa-inline-log")?.format?.format ?? null`,
		), POLL_OPTS).toBe(format);
	} finally {
		await pressKey(obsidian, "Escape");
		await obsidian.dev.evalJson("app.setting.close(); true");
		await obsidian.dev.evalJson(`app.vault.setConfig('settingsPopoutWindow', ${JSON.stringify(popout)}), true`);
	}
});
