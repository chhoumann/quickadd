import { describe, expect, it } from "vitest";
import { createQuickAddE2EHarness } from "./e2eVault";

const getContext = createQuickAddE2EHarness("choice-command-removal");

type RemovalResult = {
	registered: string[];
	remaining: string[];
	changedEvents: number;
};

describe("choice command removal", () => {
	it("removes a folder's commands through Obsidian's command registry", async () => {
		const { obsidian } = getContext();

		// A folder with its own command and a child with a pick-day command:
		// deleting the folder must take all three commands with it, and Obsidian
		// must hear about it (the "changed" event refreshes Hotkeys and friends).
		const result = await obsidian.dev.evalJson<RemovalResult>(`(() => {
			const plugin = app.plugins.plugins.quickadd;
			const folder = {
				id: "qa-e2e-removal-folder", name: "Removal folder", type: "Multi", command: true,
				choices: [{
					id: "qa-e2e-removal-child", name: "Removal child", type: "Capture", command: true,
					dateOrigin: "prompt", pickDayCommand: true,
				}],
			};
			const ours = () => Object.keys(app.commands.commands)
				.filter((id) => id.includes("qa-e2e-removal-"))
				.sort();
			plugin.addCommandForChoice(folder);
			const registered = ours();
			let changedEvents = 0;
			const ref = app.commands.on("changed", () => changedEvents++);
			try {
				plugin.removeCommandForChoice(folder, { recursive: true });
			} finally {
				app.commands.offref(ref);
			}
			return { registered, remaining: ours(), changedEvents };
		})()`);

		expect(result.registered).toEqual([
			"quickadd:choice:qa-e2e-removal-child",
			"quickadd:choice:qa-e2e-removal-child:pick-day",
			"quickadd:choice:qa-e2e-removal-folder",
		]);
		expect(result.remaining).toEqual([]);
		expect(result.changedEvents).toBeGreaterThan(0);
	});
});
