import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type { ICommand } from "../../src/types/macros/ICommand";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral, POLL_OPTS } from "./uiHelpers";

// A macro step that opens a note hands it to the next step as the current note,
// unless the caller named the current note with `current=`.
const getContext = createQuickAddE2EHarness("macro-current-note");

function runStep(choice: IChoice): ICommand {
	return { id: `run-${choice.id}`, name: choice.name, type: "Choice", choiceId: choice.id } as ICommand;
}

async function seedMacro(name: string) {
	const { obsidian, plugin, sandbox } = getContext();
	const start = await seedVaultFile(obsidian, sandbox, `${name} start.md`, "start\n");
	const template = new TemplateChoice("Make note");
	template.templatePath = await seedVaultFile(obsidian, sandbox, "Templates/Made.md", "made\n");
	template.fileNameFormat = { enabled: true, format: `${name} made` };
	template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("out")] };
	template.openFile = true;
	const capture = new CaptureChoice("Line to active");
	capture.captureToActiveFile = true;
	capture.activeFileWritePosition = "bottom";
	capture.format = { enabled: true, format: "captured" };
	const macro = new MacroChoice("Note then capture");
	macro.command = true;
	macro.macro.commands = [runStep(template), runStep(capture)];
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [template, capture, macro];
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJsonAsync(`(async () => {
		await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(${jsLiteral(start)}));
		return true;
	})()`);
	return { obsidian, sandbox, macro, start, startName: `${name} start.md`, madeName: `out/${name} made.md` };
}

it("captures into the note an earlier macro step opened", async () => {
	const { obsidian, sandbox, macro, startName, madeName } = await seedMacro("in-app");

	await obsidian.dev.evalJson(`(() => { app.commands.executeCommandById(${jsLiteral(`quickadd:choice:${macro.id}`)}); return true; })()`);

	await expect.poll(() => sandbox.read(madeName).catch(() => null), POLL_OPTS).toContain("captured");
	expect(await sandbox.read(startName)).toBe("start\n");
});

it("keeps the note named with current= for every step", async () => {
	const { obsidian, sandbox, macro, start, startName, madeName } = await seedMacro("named");

	const run = await obsidian.execJson<{ ok: boolean }>("quickadd:run", { id: macro.id, current: start });

	expect(run, JSON.stringify(run)).toMatchObject({ ok: true });
	await expect.poll(() => sandbox.read(startName), POLL_OPTS).toContain("captured");
	expect(await sandbox.read(madeName)).not.toContain("captured");
});
