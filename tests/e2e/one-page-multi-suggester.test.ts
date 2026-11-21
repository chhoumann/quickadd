import { afterEach, describe, expect, it } from "vitest";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type { ICommand } from "../../src/types/macros/ICommand";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { clickWhenStill, closeOpenPrompts, jsLiteral, POLL_OPTS, pressKey, typeInto, waitForElement } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("one-page-multi-suggester");

const FORM = ".onePageInputModal";
const SUBMIT = `${FORM} .qa-prompt-actions-primary button.mod-cta`;
const COMMA = "A string, with stuff after a comma";

const input = (id: string) => `${FORM} input[aria-labelledby="qa-onepage-label-${id}"]`;

async function openForm(inputs: string, firstId: string) {
	const { obsidian } = getContext();
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		window.__qaMultiForm = app.plugins.plugins.quickadd.api.requestInputs(${inputs});
		window.__qaMultiForm.catch(() => {});
		return true;
	})()`)).toBe(true);
	await waitForElement(obsidian, input(firstId));
}

async function submit<T>(result = "values"): Promise<T> {
	const { obsidian } = getContext();
	await clickWhenStill(obsidian, SUBMIT);
	return obsidian.dev.evalJsonAsync<T>(`window.__qaMultiForm.then((values) => (${result}))`);
}

async function suggestions(): Promise<string[]> {
	return getContext().obsidian.dev.evalJson<string[]>(
		'Array.from(document.querySelectorAll(".suggestion-container .suggestion-item"), (item) => item.textContent)',
	);
}

async function chips(): Promise<string[]> {
	return getContext().obsidian.dev.evalJson<string[]>(
		`Array.from(document.querySelectorAll("${FORM} .qa-onepage-multi-suggester__chip-label"), (chip) => chip.textContent)`,
	);
}

async function typeAndPick(id: string, text: string, expected: string[]) {
	const { obsidian } = getContext();
	await typeInto(obsidian, input(id), text);
	await expect.poll(suggestions, POLL_OPTS).toEqual(expected);
	await pressKey(obsidian, "Enter");
}

afterEach(async () => {
	await closeOpenPrompts(getContext().obsidian);
});

describe("one-page multi-select suggester", () => {
	it("keeps comma-bearing options and typed entries whole and returns them as an array", async () => {
		await openForm(`[{
			id: "tags",
			label: "Tags",
			type: "suggester",
			options: [${jsLiteral(COMMA)}, "Another string", "vip"],
			suggesterConfig: { multiSelect: true, returnArray: true },
		}]`, "tags");

		await typeAndPick("tags", "a string, with", [COMMA, "Add “a string, with”"]);
		await expect.poll(chips, POLL_OPTS).toEqual([COMMA]);
		await typeAndPick("tags", "Typed, custom entry", ["Add “Typed, custom entry”"]);
		await expect.poll(chips, POLL_OPTS).toEqual([COMMA, "Typed, custom entry"]);
		expect(await getContext().obsidian.dev.evalJson<string>(`document.querySelector(${jsLiteral(input("tags"))}).value`)).toBe("");

		expect(await submit<Record<string, unknown>>()).toEqual({ tags: [COMMA, "Typed, custom entry"] });
	});

	it("removes chips with Backspace and their buttons, folds the draft on Submit, and joins with the separator", async () => {
		await openForm(`[{
			id: "tags",
			label: "Tags",
			type: "suggester",
			options: ["client", "prospect", "vip"],
			suggesterConfig: { multiSelect: true, separator: " | " },
		}]`, "tags");
		const { obsidian } = getContext();

		await typeAndPick("tags", "cli", ["client", "Add “cli”"]);
		await typeAndPick("tags", "pro", ["prospect", "Add “pro”"]);
		await typeAndPick("tags", "vip", ["vip"]);
		await expect.poll(chips, POLL_OPTS).toEqual(["client", "prospect", "vip"]);

		await pressKey(obsidian, "Backspace");
		await expect.poll(chips, POLL_OPTS).toEqual(["client", "prospect"]);
		await clickWhenStill(obsidian, `${FORM} button[aria-label="Remove client"]`);
		await expect.poll(chips, POLL_OPTS).toEqual(["prospect"]);

		await typeInto(obsidian, input("tags"), "Draft, entry");
		expect(await submit<Record<string, unknown>>()).toEqual({ tags: "prospect | Draft, entry" });
	});

	it("returns the picked objects themselves, labelled by a displayOptions function", async () => {
		const { obsidian, sandbox } = getContext();
		const ada = await seedVaultFile(obsidian, sandbox, "People/Ada.md", "");
		const grace = await seedVaultFile(obsidian, sandbox, "People/Grace, Hopper.md", "");
		await openForm(`[{
			id: "people",
			label: "People",
			type: "suggester",
			options: [${jsLiteral(ada)}, ${jsLiteral(grace)}].map((path) => app.vault.getAbstractFileByPath(path)),
			displayOptions: (file) => file.basename,
			suggesterConfig: { multiSelect: true },
		}, {
			id: "lead",
			label: "Lead",
			type: "dropdown",
			options: [${jsLiteral(ada)}, ${jsLiteral(grace)}].map((path) => app.vault.getAbstractFileByPath(path)),
			displayOptions: (file) => file.basename,
		}]`, "people");

		await typeAndPick("people", "grace", ["Grace, Hopper", "Add “grace”"]);
		await typeAndPick("people", "ada", ["Ada"]);
		const lead = `${FORM} select[aria-labelledby="qa-onepage-label-lead"]`;
		expect(await obsidian.dev.evalJson<string[]>(
			`Array.from(document.querySelector(${jsLiteral(lead)}).options, (option) => option.textContent)`,
		)).toEqual(["Ada", "Grace, Hopper"]);
		expect(await obsidian.dev.evalJson<boolean>(`(() => {
			const select = document.querySelector(${jsLiteral(lead)});
			select.selectedIndex = 1;
			select.dispatchEvent(new Event("change"));
			return true;
		})()`)).toBe(true);

		expect(await submit<boolean[]>(
			`[values.people.length === 2, values.people[0] === app.vault.getAbstractFileByPath(${jsLiteral(grace)}), values.people[1] === app.vault.getAbstractFileByPath(${jsLiteral(ada)}), values.lead === app.vault.getAbstractFileByPath(${jsLiteral(grace)})]`,
		)).toEqual([true, true, true, true]);
	});

	it("adds only listed options when custom input is off", async () => {
		await openForm(`[{
			id: "tags",
			label: "Tags",
			type: "suggester",
			options: ["client", "vip"],
			suggesterConfig: { multiSelect: true, allowCustomInput: false },
		}]`, "tags");
		const { obsidian } = getContext();

		await typeInto(obsidian, input("tags"), "nope");
		await expect.poll(suggestions, POLL_OPTS).toEqual([]);
		await pressKey(obsidian, "Enter");
		expect(await chips()).toEqual([]);
		await typeAndPick("tags", "vip", ["vip"]);
		await expect.poll(chips, POLL_OPTS).toEqual(["vip"]);

		await typeInto(obsidian, input("tags"), "stray");
		expect(await submit<Record<string, unknown>>()).toEqual({ tags: "vip" });
	});

	it("keeps a comma-bearing {{VALUE|multi}} label whole in the one-page form", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const template = new TemplateChoice("Prioritized note");
		template.templatePath = await seedVaultFile(obsidian, sandbox, "Templates/Prioritized.md",
			'---\npriority: {{VALUE:hi,lo|text:"High, urgent",Low|multi|name:priority}}\n---\nbody\n');
		template.fileNameFormat = { enabled: true, format: "prioritized" };
		template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("out")] };
		await plugin.data<{ choices: IChoice[]; onePageInputEnabled: boolean }>().patch((data) => {
			data.choices = [template];
			data.onePageInputEnabled = true;
		});
		await plugin.reload({ waitUntilReady: true });

		await obsidian.dev.evalJson(`(() => { app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(template.name)}).catch(() => {}); return true; })()`);
		await waitForElement(obsidian, input("priority"));
		await expect.poll(suggestions, POLL_OPTS).toEqual(["High, urgent", "Low"]);
		await typeAndPick("priority", "low", ["Low"]);
		await typeAndPick("priority", "high, u", ["High, urgent"]);
		await expect.poll(chips, POLL_OPTS).toEqual(["Low", "High, urgent"]);
		await clickWhenStill(obsidian, SUBMIT);

		const frontmatter = await obsidian.metadata.waitForFrontmatter<{ priority: string[] }>(
			sandbox.path("out/prioritized.md"),
			(value) => value.priority?.length === 2,
			{ timeoutMs: 10_000, intervalMs: 200 },
		);
		expect(frontmatter.priority).toEqual(["lo", "hi"]);
	});

	it("writes a returnArray answer into the note's frontmatter as a list", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const script = await seedVaultFile(obsidian, sandbox, "ask-tags.js", `module.exports = async ({ quickAddApi }) => {
	await quickAddApi.requestInputs([{
		id: "topics",
		label: "Topics",
		type: "suggester",
		options: [${jsLiteral(COMMA)}, "Another string"],
		suggesterConfig: { multiSelect: true, returnArray: true },
	}]);
};
`);
		const template = new TemplateChoice("Tagged note");
		template.templatePath = await seedVaultFile(obsidian, sandbox, "Templates/Tagged.md", "---\ntopics: {{VALUE:topics}}\n---\nbody\n");
		template.fileNameFormat = { enabled: true, format: "tagged" };
		template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("out")] };
		const macro = new MacroChoice("Ask then write");
		macro.macro.commands = [
			{ id: "ask", name: "ask-tags", type: "UserScript", path: script, settings: {} } as ICommand,
			{ id: "write", name: template.name, type: "Choice", choiceId: template.id } as ICommand,
		];
		await plugin.data<{ choices: IChoice[] }>().patch((data) => {
			data.choices = [template, macro];
		});
		await plugin.reload({ waitUntilReady: true });

		await obsidian.dev.evalJson(`(() => { app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(macro.name)}).catch(() => {}); return true; })()`);
		await waitForElement(obsidian, input("topics"));
		await typeAndPick("topics", "a string, w", [COMMA, "Add “a string, w”"]);
		await typeAndPick("topics", "another", ["Another string", "Add “another”"]);
		await clickWhenStill(obsidian, SUBMIT);

		const frontmatter = await obsidian.metadata.waitForFrontmatter<{ topics: string[] }>(
			sandbox.path("out/tagged.md"),
			(value) => value.topics?.length === 2,
			{ timeoutMs: 10_000, intervalMs: 200 },
		);
		expect(frontmatter.topics).toEqual([COMMA, "Another string"]);
		expect(await sandbox.read("out/tagged.md")).toBe(`---\ntopics:\n  - ${COMMA}\n  - Another string\n---\nbody\n`);
	});
});
