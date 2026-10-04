import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { POLL_OPTS } from "./uiHelpers";

// {{ACTION:name}} runs any choice, not only a macro: a Capture writes its line
// and the token gives back the note it wrote to.
const getContext = createQuickAddE2EHarness("v3-action-token");

it("runs a Capture from a template's {{ACTION:}} and inserts the note it wrote to", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const logPath = sandbox.path("notes/log.md");
	const template = await seedVaultFile(obsidian, sandbox, "Templates/Entry.md", "Logged to {{ACTION:Log}}");

	const log = new CaptureChoice("Log");
	log.captureTo = logPath;
	log.onePageInput = "never";
	log.createFileIfItDoesntExist = { enabled: true, createWithTemplate: false, template: "" };
	log.format = { enabled: true, format: "- {{VALUE}}\n" };
	const entry = new TemplateChoice("Entry");
	entry.templatePath = template;
	entry.onePageInput = "never";
	entry.fileNameFormat = { enabled: true, format: "Entry {{VALUE}}" };
	entry.folder = { ...entry.folder, enabled: true, folders: [sandbox.path("entries")] };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data: { choices: IChoice[] }) => {
		data.choices = [log, entry];
	}));
	await plugin.reload({ waitUntilReady: true });

	const outcome = await obsidian.execJson("quickadd:run", {
		id: entry.id, verify: true, vars: JSON.stringify({ value: "Watered the basil" }),
	});

	expect(outcome).toMatchObject({ ok: true, file: sandbox.path("entries/Entry Watered the basil.md") });
	await expect.poll(() => sandbox.read("notes/log.md"), POLL_OPTS).toBe("- Watered the basil\n");
	await expect.poll(() => sandbox.read("entries/Entry Watered the basil.md"), POLL_OPTS)
		.toBe(`Logged to ${logPath}`);
});
