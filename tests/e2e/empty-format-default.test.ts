import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { CommandType } from "../../src/types/macros/CommandType";
import type { ICommand } from "../../src/types/macros/ICommand";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { clickAt, insertText, leaveSettingsPage, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// #1999: Capture format and File name have no toggle. An empty field means the
// default ({{VALUE}} on its own, or the note-title prompt), and typing in it
// turns it on.
const getContext = createQuickAddE2EHarness("empty-format-default");

async function openBuilder(name: string, builderClass: string) {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`(() => {
		app.setting.open(); app.setting.openTabById("quickadd");
		[...document.querySelectorAll('[aria-label="Configure ${name}"]')]
			.find(el => el.getClientRects().length > 0).click();
		return true;
	})()`);
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`Boolean(document.querySelector(".${builderClass}"))`,
	), POLL_OPTS).toBe(true);
}

/** The field under a labelled row, and whether the row still has a toggle. */
function field(builderClass: string, label: string) {
	return getContext().obsidian.dev.evalJson<{ value: string; hasToggle: boolean } | null>(`(() => {
		const row = [...document.querySelectorAll(".${builderClass} .qa-field")]
			.find(el => el.querySelector(".setting-item-name")?.textContent === ${JSON.stringify(label)});
		const input = row?.querySelector("input, textarea");
		return input ? { value: input.value, hasToggle: Boolean(row.querySelector(".checkbox-container")) } : null;
	})()`);
}

async function leaveBuilder(builderClass: string) {
	const { obsidian } = getContext();
	await leaveSettingsPage(obsidian);
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`Boolean(document.querySelector(".${builderClass}"))`,
	), POLL_OPTS).toBe(false);
}

async function closeAll() {
	await getContext().obsidian.dev.evalJson("app.setting.close(), true");
}

it("writes the value on its own until a Capture format is typed", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const inbox = await seedVaultFile(obsidian, sandbox, "Inbox.md", "");
	const choice = new CaptureChoice("Empty format capture");
	choice.captureTo = inbox;
	choice.prepend = true;
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [choice];
	}));
	await plugin.reload({ waitUntilReady: true });

	try {
		await obsidian.exec("quickadd:run", { choice: choice.name, "value-value": "plain" });
		await expect.poll(() => sandbox.read("Inbox.md"), POLL_OPTS).toContain("plain");

		await openBuilder(choice.name, "captureChoiceBuilder");
		expect(await field("captureChoiceBuilder", "Capture format")).toEqual({ value: "", hasToggle: false });
		await typeInto(obsidian, ".captureChoiceBuilder .qa-field textarea", "- {{VALUE}}");
		await leaveBuilder("captureChoiceBuilder");

		await obsidian.exec("quickadd:run", { choice: choice.name, "value-value": "listed" });
		await expect.poll(() => sandbox.read("Inbox.md"), POLL_OPTS).toContain("- listed");
		expect(await sandbox.read("Inbox.md")).not.toContain("- plain");
	} finally {
		await closeAll();
	}
});

// #2004 review: a format can start with indentation while it has no other text.
it("keeps a Tab and a space typed first into an empty Capture format", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const choice = new CaptureChoice("Indented format capture");
	choice.captureTo = await seedVaultFile(obsidian, sandbox, "Indented.md", "");
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [choice];
	}));
	await plugin.reload({ waitUntilReady: true });

	try {
		await openBuilder(choice.name, "captureChoiceBuilder");
		const point = await obsidian.dev.evalJson<{ x: number; y: number }>(`(() => {
			const box = document.querySelector(".captureChoiceBuilder .qa-field textarea");
			box.scrollIntoView({ block: "center" });
			const rect = box.getBoundingClientRect();
			return { x: rect.left + 20, y: rect.top + 10 };
		})()`);
		await clickAt(obsidian, point.x, point.y);
		await pressKey(obsidian, "Tab");
		await insertText(obsidian, " ");
		const box = () => obsidian.dev.evalJson<string>(`document.querySelector(".captureChoiceBuilder .qa-field textarea").value`);
		expect(await box()).toBe("\t ");
		await insertText(obsidian, "- {{VALUE}}");
		expect(await box()).toBe("\t - {{VALUE}}");
		await leaveBuilder("captureChoiceBuilder");
		expect(await obsidian.dev.evalJson(
			`app.plugins.plugins.quickadd.settings.choices.find(c => c.id === ${JSON.stringify(choice.id)}).format`,
		)).toEqual({ enabled: true, format: "\t - {{VALUE}}" });
	} finally {
		await closeAll();
	}
});

it("asks for the note title while File name is empty", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const template = await seedVaultFile(obsidian, sandbox, "Note template.md", "body\n");
	const folder = sandbox.path("Notes");
	const choice = new TemplateChoice("Empty file name template");
	choice.templatePath = template;
	choice.folder = { ...choice.folder, enabled: true, folders: [folder] };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [choice];
	}));
	await plugin.reload({ waitUntilReady: true });

	try {
		await openBuilder(choice.name, "templateChoiceBuilder");
		expect(await field("templateChoiceBuilder", "File name")).toEqual({ value: "", hasToggle: false });
		await typeInto(obsidian, ".templateChoiceBuilder .qa-field input[placeholder='{{VALUE}}']", "Log {{VALUE:topic}}");
		await leaveBuilder("templateChoiceBuilder");
		await obsidian.exec("quickadd:run", { choice: choice.name, "value-topic": "one" });
		await expect.poll(() => sandbox.read("Notes/Log one.md").then(() => true, () => false), POLL_OPTS).toBe(true);

		// Clearing the field returns to the note-title prompt.
		await openBuilder(choice.name, "templateChoiceBuilder");
		await typeInto(obsidian, ".templateChoiceBuilder .qa-field input[placeholder='{{VALUE}}']", "");
		await leaveBuilder("templateChoiceBuilder");
		expect(await obsidian.dev.evalJson(
			`app.plugins.plugins.quickadd.settings.choices.find(c => c.id === ${JSON.stringify(choice.id)}).fileNameFormat`,
		)).toEqual({ enabled: false, format: "" });
		await obsidian.exec("quickadd:run", { choice: choice.name, "value-value": "Plain title" });
		await expect.poll(() => sandbox.read("Notes/Plain title.md").then(() => true, () => false), POLL_OPTS).toBe(true);
	} finally {
		await closeAll();
	}
});

// #2047: QuickAdd 2.29.0 and earlier saved `enabled: true` with no text when the
// toggle was switched on and left empty. The builder now shows that as an empty
// field, which means the default, so the run must do the same.
it("runs a legacy choice saved with its toggle on and no text as the default", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const inbox = await seedVaultFile(obsidian, sandbox, "Legacy inbox.md", "# Inbox\n");
	const template = await seedVaultFile(obsidian, sandbox, "Legacy template.md", "body\n");
	const capture = new CaptureChoice("Legacy empty format capture");
	capture.captureTo = inbox;
	capture.prepend = true;
	capture.format = { enabled: true, format: "" };
	const nested = new CaptureChoice("Legacy nested capture");
	nested.captureTo = inbox;
	nested.prepend = true;
	nested.format = { enabled: true, format: "  " };
	const macro = new MacroChoice("Legacy empty format macro");
	macro.macro.commands = [{ id: "nested", name: nested.name, type: CommandType.NestedChoice, choice: nested } as ICommand];
	const templateChoice = new TemplateChoice("Legacy empty file name template");
	templateChoice.templatePath = template;
	templateChoice.folder = { ...templateChoice.folder, enabled: true, folders: [sandbox.path("Legacy")] };
	templateChoice.fileNameFormat = { enabled: true, format: "" };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [capture, macro, templateChoice];
	}));
	await plugin.reload({ waitUntilReady: true });

	const captured = await obsidian.execJson<{ ok: boolean; effect: string }>("quickadd:run", {
		id: capture.id, verify: true, "value-value": "from the capture",
	});
	expect(captured).toMatchObject({ ok: true, effect: "changed" });
	await obsidian.execJson("quickadd:run", { id: macro.id, "value-value": "from the macro" });
	await expect.poll(() => sandbox.read("Legacy inbox.md"), POLL_OPTS)
		.toBe("# Inbox\nfrom the capture\nfrom the macro");

	const created = await obsidian.execJson<{ ok: boolean; file?: string }>("quickadd:run", {
		id: templateChoice.id, verify: true, "value-value": "Legacy title",
	});
	expect(created).toMatchObject({ ok: true, file: `${sandbox.path("Legacy")}/Legacy title.md` });

	// What agents read (quickadd:list) agrees with the run.
	const listed = await obsidian.execJson<{ choices: { id: string; writes?: Record<string, string> }[] }>("quickadd:list", {});
	expect(listed.choices.find((c) => c.id === capture.id)?.writes?.format).toBe("{{VALUE}}");
	expect(listed.choices.find((c) => c.id === templateChoice.id)?.writes?.fileName).toBe("{{VALUE}}");
});
