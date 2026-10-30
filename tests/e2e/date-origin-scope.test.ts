import { expect, it } from "vitest";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type { IUserScript } from "../../src/types/macros/IUserScript";
import { CommandType } from "../../src/types/macros/CommandType";
import type { DateOrigin } from "../../src/types/dateOrigin";
import { NestedChoiceCommand } from "../../src/types/macros/QuickCommands/NestedChoiceCommand";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("date-origin-scope");
const DATE_INPUT = ".qaDatePrompt input.qa-vdate-input";

async function datedTemplate(name: string, folder: string, dateOrigin?: DateOrigin) {
	const { obsidian, sandbox } = getContext();
	const template = new TemplateChoice(name);
	template.templatePath = await seedVaultFile(obsidian, sandbox, "Templates/Dated.md", "{{DATE}}");
	template.fileNameFormat = { enabled: true, format: "{{DATE}}" };
	template.folder = { ...template.folder, enabled: true, folders: [sandbox.path(folder)] };
	template.dateOrigin = dateOrigin;
	return template;
}

async function scriptStep(file: string, body: string): Promise<IUserScript> {
	const { obsidian, sandbox } = getContext();
	const path = await seedVaultFile(obsidian, sandbox, file, `module.exports = async (params) => { ${body} };`);
	return { id: file, name: file, type: CommandType.UserScript, path, settings: {} };
}

async function runMacro(choices: IChoice[], macro: MacroChoice) {
	const { obsidian, plugin } = getContext();
	macro.command = true;
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [...choices, macro];
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.exec("command", { id: `quickadd:choice:${macro.id}` });
}

it("gives each nested Template its own variable day", async () => {
	const { sandbox } = getContext();
	const macro = new MacroChoice("Yesterday and tomorrow");
	macro.macro.commands = [
		await scriptStep("set-days.js", `params.variables.yesterday = "2026-01-02"; params.variables.tomorrow = "2026-01-04";`),
		new NestedChoiceCommand(await datedTemplate("Yesterday note", "nested", { kind: "variable", name: "yesterday" })),
		new NestedChoiceCommand(await datedTemplate("Tomorrow note", "nested", { kind: "variable", name: "tomorrow" })),
	];

	await runMacro([], macro);

	await expect.poll(() => sandbox.read("nested/2026-01-04.md").catch(() => null), POLL_OPTS).toBe("2026-01-04");
	expect(await sandbox.read("nested/2026-01-02.md")).toBe("2026-01-02");
});

it("gives each executeChoice call its own options.date", async () => {
	const { sandbox } = getContext();
	const template = await datedTemplate("Dated note", "api");
	const macro = new MacroChoice("Two executeChoice days");
	macro.macro.commands = [
		await scriptStep("execute-days.js", `
			await params.quickAddApi.executeChoice("Dated note", {}, { date: "2026-01-02" });
			await params.quickAddApi.executeChoice("Dated note", {}, { date: "2026-01-04" });`),
	];

	await runMacro([template], macro);

	await expect.poll(() => sandbox.read("api/2026-01-04.md").catch(() => null), POLL_OPTS).toBe("2026-01-04");
	expect(await sandbox.read("api/2026-01-02.md")).toBe("2026-01-02");
});

it("still hands a Macro's own day to its nested Templates", async () => {
	const { obsidian, sandbox } = getContext();
	const macro = new MacroChoice("Macro day");
	macro.dateOrigin = { kind: "relative", offset: -1, unit: "days" };
	macro.macro.commands = [
		new NestedChoiceCommand(await datedTemplate("First child", "inherited")),
		new NestedChoiceCommand(await datedTemplate("Second child", "inherited/again")),
	];
	const yesterday = await obsidian.dev.evalJson<string>(
		`window.moment().subtract(1, "day").format("YYYY-MM-DD")`,
	);

	await runMacro([], macro);

	await expect.poll(() => sandbox.read(`inherited/again/${yesterday}.md`).catch(() => null), POLL_OPTS).toBe(yesterday);
	expect(await sandbox.read(`inherited/${yesterday}.md`)).toBe(yesterday);
});

it("gives each executeChoice call its own variable day", async () => {
	const { sandbox } = getContext();
	const template = await datedTemplate("Variable note", "api-variable", { kind: "variable", name: "day" });
	const macro = new MacroChoice("Two executeChoice variables");
	macro.macro.commands = [
		await scriptStep("execute-variables.js", `
			await params.quickAddApi.executeChoice("Variable note", { day: "2026-01-02" });
			await params.quickAddApi.executeChoice("Variable note", { day: "2026-01-04" });`),
	];

	await runMacro([template], macro);

	await expect.poll(() => sandbox.read("api-variable/2026-01-04.md").catch(() => null), POLL_OPTS).toBe("2026-01-04");
	expect(await sandbox.read("api-variable/2026-01-02.md")).toBe("2026-01-02");
});

it("keeps an executeChoice options.date out of later macro steps", async () => {
	const { sandbox } = getContext();
	const template = await datedTemplate("Dated note", "after-api");
	const macro = new MacroChoice("executeChoice then nested");
	macro.macro.commands = [
		await scriptStep("execute-then-set.js", `
			await params.quickAddApi.executeChoice("Dated note", {}, { date: "2026-01-02" });
			params.variables.tomorrow = "2026-01-04";`),
		new NestedChoiceCommand(await datedTemplate("Tomorrow note", "after-api", { kind: "variable", name: "tomorrow" })),
	];

	await runMacro([template], macro);

	await expect.poll(() => sandbox.read("after-api/2026-01-04.md").catch(() => null), POLL_OPTS).toBe("2026-01-04");
	expect(await sandbox.read("after-api/2026-01-02.md")).toBe("2026-01-02");
});

it("keeps a nested variable day when the macro runs with Pick a day", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const macro = new MacroChoice("Picked macro");
	macro.command = true;
	macro.pickDayCommand = true;
	macro.macro.commands = [
		await scriptStep("set-test-date.js", `params.variables.testDate = "2026-01-02";`),
		new NestedChoiceCommand(await datedTemplate("Variable child", "picked/variable", { kind: "variable", name: "testDate" })),
		new NestedChoiceCommand(await datedTemplate("Today child", "picked/today")),
	];
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = [macro];
	});
	await plugin.reload({ waitUntilReady: true });

	await obsidian.exec("command", { id: `quickadd:choice:${macro.id}:pick-day` });
	await typeInto(obsidian, DATE_INPUT, "2026-03-01");
	await pressKey(obsidian, "Enter");

	await expect.poll(() => sandbox.read("picked/today/2026-03-01.md").catch(() => null), POLL_OPTS).toBe("2026-03-01");
	expect(await sandbox.read("picked/variable/2026-01-02.md")).toBe("2026-01-02");
});
