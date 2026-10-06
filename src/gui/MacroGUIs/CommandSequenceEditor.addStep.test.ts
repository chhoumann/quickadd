import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { flushSync } from "svelte";
import { testApp } from "../../../tests/helpers/settings/modalApp";
import { openAddStepMenu } from "../../../tests/helpers/settings/addStepMenu";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { MacroChoice } from "../../types/choices/MacroChoice";
import { MultiChoice } from "../../types/choices/MultiChoice";
import { settingsStore } from "../../settingsStore";
import GenericSuggester from "../GenericSuggester/genericSuggester";
import { CommandSequenceEditor } from "./CommandSequenceEditor";
import { MacroBuilder } from "./MacroBuilder";

function renderEditor(choices: IChoice[] = []) {
	const onCommandsChange = vi.fn();
	const editor = new CommandSequenceEditor({
		app: testApp(),
		plugin: {} as QuickAdd,
		commands: [],
		choices,
		onCommandsChange,
	});
	const container = document.createElement("div");
	document.body.appendChild(container);
	editor.render(container);
	return { container, onCommandsChange };
}

/** Each row: its name, then what it says under it. */
function rows(container: HTMLElement): string[][] {
	return Array.from(container.querySelectorAll(".quickAddCommandListItem"), (row) =>
		Array.from(row.querySelectorAll(".quickAddCommandLabel, .quickAddCommandDetail"), (el) => el.textContent?.trim() ?? ""),
	);
}

describe("Add a step", () => {
	afterEach(() => {
		settingsStore.setState({ disableOnlineFeatures: true });
		vi.restoreAllMocks();
		document.body.replaceChildren();
	});

	it("offers the steps a sequence can hold, grouped as writes and what follows", () => {
		settingsStore.setState({ disableOnlineFeatures: false });
		const { container } = renderEditor();

		expect(openAddStepMenu(container).titles).toEqual([
			"[Write]",
			"Create a note",
			"Add to a note",
			"[Then]",
			"Open a note",
			"Link it",
			"Run Templater",
			"Run a script",
			"Run a command",
			"Run an editor command",
			"Ask AI",
			"Run a choice",
			"If",
			"Wait",
		]);
	});

	it("leaves out Ask AI while online features are off", () => {
		settingsStore.setState({ disableOnlineFeatures: true });
		const { container } = renderEditor();

		expect(openAddStepMenu(container).titles).not.toContain("Ask AI");
	});

	it("adds a wait of 100 ms", () => {
		const { container, onCommandsChange } = renderEditor();

		openAddStepMenu(container).pick("Wait");
		flushSync();

		expect(onCommandsChange).toHaveBeenCalledTimes(1);
		expect(onCommandsChange.mock.lastCall?.[0]).toEqual([expect.objectContaining({ type: "Wait", time: 100 })]);
		expect(container.querySelectorAll(".quickAddCommandListItem")).toHaveLength(1);
	});

	it("adds a link to the run note on a new line in the current note, and a Templater run on it", () => {
		const { container, onCommandsChange } = renderEditor();

		openAddStepMenu(container).pick("Link it");
		openAddStepMenu(container).pick("Run Templater");
		flushSync();

		const commands = onCommandsChange.mock.lastCall?.[0];
		expect(commands).toEqual([
			expect.objectContaining({
				type: "v3-step",
				step: expect.objectContaining({
					type: "link",
					link: "{{NOTE}}",
					insert: { placement: "newLine", requireActiveFile: false },
				}),
			}),
			expect.objectContaining({ type: "v3-step", step: expect.objectContaining({ type: "templater", note: "{{NOTE}}" }) }),
		]);
		expect(rows(container)).toEqual([
			["Link it", "Links it here"],
			["Run Templater", "Runs Templater on it"],
		]);
	});

	it("runs a choice picked from every choice but the sequence's own", async () => {
		const inbox = new CaptureChoice("Inbox");
		const nested = new CaptureChoice("Journal");
		const self = new MacroChoice("Morning");
		const suggest = vi.spyOn(GenericSuggester, "Suggest").mockResolvedValue(nested);
		const page = new MacroBuilder(
			new App(),
			{} as QuickAdd,
			self,
			[self, inbox, new MultiChoice("Folder").addChoices([nested])],
			() => {},
		);
		page.display();

		openAddStepMenu(page.containerEl).pick("Run a choice");

		expect(suggest.mock.calls[0][1]).toEqual(["Inbox", "Journal"]);
		await vi.waitFor(() =>
			expect(self.macro.commands).toEqual([expect.objectContaining({ type: "Choice", choiceId: nested.id })]),
		);
	});
});
