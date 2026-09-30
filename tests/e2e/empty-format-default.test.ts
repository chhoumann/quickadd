import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { clickAt, insertText, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

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

async function clickDone(builderClass: string) {
	const { obsidian } = getContext();
	const point = await obsidian.dev.evalJson<{ x: number; y: number }>(`(() => {
		const button = [...document.querySelectorAll(".${builderClass} button")]
			.find(b => b.textContent?.trim() === "Done");
		const rect = button.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	})()`);
	await clickAt(obsidian, point.x, point.y);
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`Boolean(document.querySelector(".${builderClass}"))`,
	), POLL_OPTS).toBe(false);
}

async function closeAll() {
	await getContext().obsidian.dev.evalJson(`(() => {
		for (const button of document.querySelectorAll(".quickAddModal button")) {
			if (button.textContent?.trim() === "Done") button.click();
		}
		app.setting.close();
		return true;
	})()`);
}

it("writes the value on its own until a Capture format is typed", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const inbox = await seedVaultFile(obsidian, sandbox, "Inbox.md", "");
	const choice = new CaptureChoice("Empty format capture");
	choice.captureTo = inbox;
	choice.prepend = true;
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	try {
		await obsidian.exec("quickadd:run", { choice: choice.name, "value-value": "plain" });
		await expect.poll(() => sandbox.read("Inbox.md"), POLL_OPTS).toContain("plain");

		await openBuilder(choice.name, "captureChoiceBuilder");
		expect(await field("captureChoiceBuilder", "Capture format")).toEqual({ value: "", hasToggle: false });
		await typeInto(obsidian, ".captureChoiceBuilder .qa-field textarea", "- {{VALUE}}");
		await clickDone("captureChoiceBuilder");

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
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
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
		await clickDone("captureChoiceBuilder");
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
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [choice];
	});
	await plugin.reload({ waitUntilReady: true });

	try {
		await openBuilder(choice.name, "templateChoiceBuilder");
		expect(await field("templateChoiceBuilder", "File name")).toEqual({ value: "", hasToggle: false });
		await typeInto(obsidian, ".templateChoiceBuilder .qa-field input[placeholder='{{VALUE}}']", "Log {{VALUE:topic}}");
		await clickDone("templateChoiceBuilder");
		await obsidian.exec("quickadd:run", { choice: choice.name, "value-topic": "one" });
		await expect.poll(() => sandbox.read("Notes/Log one.md").then(() => true, () => false), POLL_OPTS).toBe(true);

		// Clearing the field returns to the note-title prompt.
		await openBuilder(choice.name, "templateChoiceBuilder");
		await typeInto(obsidian, ".templateChoiceBuilder .qa-field input[placeholder='{{VALUE}}']", "");
		await clickDone("templateChoiceBuilder");
		expect(await obsidian.dev.evalJson(
			`app.plugins.plugins.quickadd.settings.choices.find(c => c.id === ${JSON.stringify(choice.id)}).fileNameFormat`,
		)).toEqual({ enabled: false, format: "" });
		await obsidian.exec("quickadd:run", { choice: choice.name, "value-value": "Plain title" });
		await expect.poll(() => sandbox.read("Notes/Plain title.md").then(() => true, () => false), POLL_OPTS).toBe(true);
	} finally {
		await closeAll();
	}
});
