import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";

// #2007: the docs said a Capture format must end with `\n` "so each capture
// lands as its own complete line". Every line-based write position already puts
// each entry on its own line, and ends up with the same note as the `\n` format.
const getContext = createQuickAddE2EHarness("capture-trailing-newline");

const NOTE = "# Day\n\n## Journal\n- 09:00 existing\n\n## Tasks\n- [ ] existing\n";

type Position = "top" | "bottom" | "afterTop" | "afterEnd";

function capture(name: string, target: string, format: string, position: Position) {
	const choice = new CaptureChoice(name);
	choice.captureTo = target;
	choice.format = { enabled: true, format };
	choice.prepend = position === "bottom";
	if (position === "afterTop" || position === "afterEnd") {
		choice.insertAfter = {
			...choice.insertAfter,
			enabled: true,
			after: "## Journal",
			insertAtEnd: position === "afterEnd",
		};
	}
	return choice;
}

it.each<Position>(["top", "bottom", "afterTop", "afterEnd"])(
	"%s: writes each entry on its own line without a trailing \\n",
	async (position) => {
		const { obsidian, plugin, sandbox } = getContext();
		const plain = await seedVaultFile(obsidian, sandbox, `${position}-plain.md`, NOTE);
		const newline = await seedVaultFile(obsidian, sandbox, `${position}-newline.md`, NOTE);
		const choices = [
			capture(`${position} plain`, plain, "- {{VALUE}}", position),
			capture(`${position} newline`, newline, "- {{VALUE}}\n", position),
		];
		await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
			data.choices = choices;
		}));
		await plugin.reload({ waitUntilReady: true });

		for (const choice of choices) {
			for (const entry of ["first", "second"]) {
				await obsidian.exec("quickadd:run", { choice: choice.name, "value-value": entry });
			}
		}

		const written = await sandbox.read(`${position}-plain.md`);
		const lines = written.split("\n");
		expect(lines).toContain("- first");
		expect(lines).toContain("- second");
		// At the bottom of the file the `\n` format also leaves a final newline;
		// nothing else differs.
		expect(written.trimEnd()).toBe((await sandbox.read(`${position}-newline.md`)).trimEnd());
	},
);
