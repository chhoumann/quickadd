import { afterEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("capture-user-text");

// Executing this fence would set the flag and write SCRIPT-RAN.
const FENCE = "```js quickadd\nwindow.__qaUserTextFenceRan = true;\nreturn 'SCRIPT-RAN';\n```";
const USER_TEXT = `clipped from a web page:\n${FENCE}\n{{DATE:YYYY}}`;

async function setup(format: string) {
	const { obsidian, sandbox, plugin } = getContext();
	const choice = new CaptureChoice("Capture user text");
	choice.command = true;
	choice.onePageInput = "never";
	choice.captureTo = await seedVaultFile(obsidian, sandbox, `inbox-${choice.id}.md`, "# Inbox\n");
	choice.format = { enabled: true, format };
	choice.prepend = true;
	await plugin.data<{ choices: IChoice[] }>().patch(data => { data.choices.push(choice); });
	await plugin.reload({ waitUntilReady: true });
	return choice;
}

async function captured(path: string) {
	return getContext().obsidian.dev.evalJsonAsync<string>(`(async () =>
		app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))
	)()`);
}

async function fenceRan() {
	return getContext().obsidian.dev.evalJson<boolean>("window.__qaUserTextFenceRan === true");
}

describe("Capture writes user-supplied text verbatim in native Obsidian", () => {
	afterEach(async () => {
		await getContext().obsidian.dev.evalJson("(() => { delete window.__qaUserTextFenceRan; return true; })()");
	});

	it("captures a selected fence as text when run from the choice's command", async () => {
		const { obsidian, sandbox } = getContext();
		const choice = await setup("{{SELECTED}}");
		const source = await seedVaultFile(obsidian, sandbox, `source-${choice.id}.md`, USER_TEXT);
		await obsidian.dev.evalJsonAsync(`(async () => {
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(source)}), { state: { mode: "source" } });
			app.workspace.setActiveLeaf(leaf, { focus: true });
			const editor = leaf.view.editor;
			editor.focus();
			editor.setSelection({ line: 0, ch: 0 }, { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length });
			return editor.getSelection().length > 0;
		})()`);

		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		await expect.poll(() => captured(choice.captureTo), POLL_OPTS).not.toBe("# Inbox\n");
		expect(await captured(choice.captureTo)).toBe(`# Inbox\n${USER_TEXT}`);
		expect(await fenceRan()).toBe(false);
	});

	it("captures a value passed in an obsidian:// link as text", async () => {
		const { obsidian } = getContext();
		const choice = await setup("{{VALUE}}");

		// The renderer entry point Obsidian calls for an opened obsidian:// URL.
		await obsidian.dev.evalJson(`(() => {
			window.OBS_ACT({ action: "quickadd", choice: ${JSON.stringify(choice.name)}, "value-value": ${JSON.stringify(USER_TEXT)} });
			return true;
		})()`);

		await expect.poll(() => captured(choice.captureTo), POLL_OPTS).not.toBe("# Inbox\n");
		expect(await captured(choice.captureTo)).toBe(`# Inbox\n${USER_TEXT}`);
		expect(await fenceRan()).toBe(false);
	});
});
