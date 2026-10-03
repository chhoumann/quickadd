import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("canvas-capture-active");

it("captures to the selected text card of the canvas in the active tab", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const canvas = {
		nodes: [{ id: "card", type: "text", text: "Start", x: 0, y: 0, width: 240, height: 80 }],
		edges: [],
	};
	const path = await seedVaultFile(obsidian, sandbox, "Board.canvas", JSON.stringify(canvas));
	const choice = new CaptureChoice("Capture to canvas card");
	choice.captureToActiveFile = true;
	choice.activeFileWritePosition = "bottom";
	choice.onePageInput = "never";
	choice.format = { enabled: true, format: "{{VALUE}}" };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	const selected = await obsidian.dev.evalJsonAsync<boolean>(`(async () => {
		const leaf = app.workspace.getLeaf(true);
		await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)}));
		app.workspace.setActiveLeaf(leaf, { focus: true });
		const canvas = leaf.view.canvas;
		for (let i = 0; i < 50 && !canvas.nodes.get("card"); i++) {
			await new Promise((r) => setTimeout(r, 100));
		}
		canvas.selectOnly(canvas.nodes.get("card"));
		return canvas.selection.size === 1;
	})()`);
	expect(selected).toBe(true);

	await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, vars: JSON.stringify({ value: "Added" }) });

	// The canvas view saves its edit to the file a moment later.
	await expect.poll(async () => {
		const data = JSON.parse(await sandbox.read("Board.canvas")) as typeof canvas;
		return data.nodes[0].text;
	}, POLL_OPTS).toBe("Start\nAdded");
});
