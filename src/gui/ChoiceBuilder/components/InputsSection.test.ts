import { fireEvent, render } from "@testing-library/svelte";
import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../../settings";
import { settingsStore } from "../../../settingsStore";
import { CaptureChoice } from "../../../types/choices/CaptureChoice";
import type IChoice from "../../../types/choices/IChoice";
import { MacroChoice } from "../../../types/choices/MacroChoice";
import { TemplateChoice } from "../../../types/choices/TemplateChoice";
import { CommandType } from "../../../types/macros/CommandType";
import type { ICommand } from "../../../types/macros/ICommand";
import { migrateSettingsV2 } from "../../../v3/migrate";
import { findAction } from "../../../v3/storage";
import InputsSection from "./InputsSection.svelte";

const files: Record<string, string> = {
	"Templates/Visit.md": "Guest: {{VALUE:Guest}}",
	"Templates/Dinner.md": '# <% tp.system.prompt("Guest") %>\nTopic: {{VALUE:Topic}}',
	"Templates/Meeting.md": "# {{VALUE:Title}}\nGuest: {{VALUE:Guest}}",
};
const openFile = vi.fn(async () => {});
const app = {
	vault: {
		getAbstractFileByPath: (path: string) => (path in files ? { path } : null),
		cachedRead: async (file: { path: string }) => files[file.path] ?? "",
	},
	workspace: { getLeaf: () => ({ openFile }) },
} as unknown as App;

vi.mock("../../../utils/templateFolderUtils", () => ({
	getTemplateFile: (_app: unknown, path: string) => (path in files ? { path } : null),
}));

function useSettings(choices: IChoice[]) {
	const { actions } = migrateSettingsV2({ choices: JSON.parse(JSON.stringify(choices)) });
	settingsStore.replaceState({
		...structuredClone(DEFAULT_SETTINGS),
		migrations: { ...DEFAULT_SETTINGS.migrations, migrateToV3Actions: true },
		choices,
		actions,
	});
}

const rows = (container: HTMLElement) =>
	[...container.querySelectorAll<HTMLElement>(".qaInputRow")].map((row) => ({
		name: row.querySelector(".setting-item-name")?.textContent?.replace(/\s+/g, " ").trim(),
		where: row.querySelector(".setting-item-description")?.textContent?.replace(/\s+/g, " ").trim(),
		controls: row.querySelectorAll("input[type=text], [role=switch]").length,
	}));

async function mount(choice: IChoice) {
	const result = render(InputsSection, { props: { choice, app } });
	await vi.waitFor(() => expect(result.container.querySelector(".setting-group")).not.toBeNull());
	return result;
}

const log = Object.assign(new CaptureChoice("Log"), { id: "log", captureTo: "Log.md" });
log.format = { enabled: true, format: "- {{VALUE:Title}} due {{VDATE:Due,YYYY-MM-DD}}" };

describe("InputsSection", () => {
	beforeEach(() => openFile.mockClear());

	it("lists a capture's inputs in the order the run asks, with their kind and where they are defined", async () => {
		useSettings([log]);
		const { container } = await mount(log);

		expect(rows(container)).toEqual([
			{ name: "Title value", where: "Defined in the format", controls: 2 },
			{ name: "Due date", where: "Defined in the format", controls: 2 },
		]);
	});

	it("names the template file an input is defined in, and opens it", async () => {
		const visit = Object.assign(new TemplateChoice("Visit"), { id: "visit", templatePath: "Templates/Visit.md" });
		visit.fileNameFormat = { enabled: true, format: "{{DATE}}" };
		useSettings([visit]);
		const { container } = await mount(visit);

		expect(rows(container)).toEqual([{ name: "Guest value", where: "Defined in Visit.md", controls: 2 }]);
		await fireEvent.click(container.querySelector(".qaInputRow a")!);
		expect(openFile).toHaveBeenCalledWith({ path: "Templates/Visit.md" });
	});

	it("shows a Templater prompt muted and without controls, after the file's own inputs", async () => {
		const dinner = Object.assign(new TemplateChoice("Dinner"), { id: "dinner", templatePath: "Templates/Dinner.md" });
		dinner.fileNameFormat = { enabled: true, format: "{{DATE}}" };
		useSettings([dinner]);
		const { container } = await mount(dinner);

		expect(rows(container)).toEqual([
			{ name: "Topic value", where: "Defined in Dinner.md", controls: 2 },
			{ name: "Guest", where: "Asked by Templater, in Dinner.md", controls: 0 },
		]);
		const guest = container.querySelectorAll<HTMLElement>(".qaInputRow")[1];
		expect(guest).toHaveClass("qaInputProvided");
		await fireEvent.click(guest.querySelector("a")!);
		expect(openFile).toHaveBeenCalledWith({ path: "Templates/Dinner.md" });
	});

	it("shows a template file's title as filled from the note title, muted and without controls", async () => {
		const meeting = Object.assign(new TemplateChoice("Meeting"), { id: "meeting", templatePath: "Templates/Meeting.md" });
		useSettings([meeting]);
		const { container } = await mount(meeting);

		expect(rows(container)).toEqual([
			{ name: "Note title value", where: "Defined in the note name", controls: 2 },
			{ name: "Title value", where: "Filled from the note title", controls: 0 },
			{ name: "Guest value", where: "Defined in Meeting.md", controls: 2 },
		]);
		expect(container.querySelector('[data-input="Title"]')).toHaveClass("qaInputProvided");
	});

	it("saves a label and optional to the action as they change", async () => {
		useSettings([log]);
		const { container } = await mount(log);
		const title = container.querySelector<HTMLElement>('[data-input="Title"]')!;

		await fireEvent.input(title.querySelector("input")!, { target: { value: "What happened?" } });
		await fireEvent.click(title.querySelector('[role="switch"]')!);
		expect(findAction(settingsStore.getState().actions, "log")?.inputs).toEqual({
			Title: { label: "What happened?", optional: true },
		});

		await fireEvent.input(title.querySelector("input")!, { target: { value: "" } });
		await fireEvent.click(title.querySelector('[role="switch"]')!);
		expect(findAction(settingsStore.getState().actions, "log")).not.toHaveProperty("inputs");
	});

	it("shows an input an earlier step may provide without controls", async () => {
		const macro = Object.assign(new MacroChoice("Morning"), { id: "morning" });
		const script = { id: "s1", name: "Set mood", type: CommandType.UserScript, path: "mood.js", settings: {} };
		const nested = { id: "n1", name: "Log", type: CommandType.NestedChoice, choice: log };
		macro.macro.commands = [script, nested] as ICommand[];
		useSettings([macro]);
		const { container } = await mount(macro);

		expect(rows(container)).toEqual([
			{ name: "Title value", where: "Provided by step 1", controls: 0 },
			{ name: "Due date", where: "Provided by step 1", controls: 0 },
		]);
	});

	it("says when the choice asks for nothing", async () => {
		const quiet = Object.assign(new CaptureChoice("Quiet"), { id: "quiet", captureTo: "Log.md" });
		quiet.format = { enabled: true, format: "- {{DATE}}" };
		useSettings([quiet]);
		const { container } = await mount(quiet);

		expect(container.querySelector(".setting-items")?.textContent?.trim()).toBe("No inputs");
	});
});
