import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandType } from "../../types/macros/CommandType";
import { render } from "@testing-library/svelte";
import { App, TFile } from "obsidian";
import CommandList from "./CommandList.svelte";
import { createCommandListProps } from "./commandListProps.svelte";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { NestedChoiceCommand } from "../../types/macros/QuickCommands/NestedChoiceCommand";
import { OpenFileCommand } from "../../types/macros/QuickCommands/OpenFileCommand";
import { UserScript } from "../../types/macros/UserScript";
import { WaitCommand } from "../../types/macros/QuickCommands/WaitCommand";
import { ObsidianCommand } from "../../types/macros/ObsidianCommand";

vi.mock("../../quickAddInstance", () => ({ getQuickAddInstance: vi.fn(() => ({})) }));

const app = new App();
app.vault.getAbstractFileByPath = (path: string) => {
	const file = new TFile();
	file.path = path;
	return file;
};

/** Each row of the list: its name, then what it says under it. */
function rows(container: HTMLElement): string[][] {
	return Array.from(container.querySelectorAll(".quickAddCommandListItem"), (row) =>
		Array.from(row.querySelectorAll(".quickAddCommandLabel, .quickAddCommandDetail"), (el) =>
			// A wait's line carries its number in an input.
			Array.from(el.childNodes, (node) => (node instanceof HTMLInputElement ? node.value : node.textContent)).join("").trim(),
		),
	);
}

describe("CommandList rows", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("says under each step's name what it does", () => {
		const inbox = new CaptureChoice("Add to note");
		inbox.captureTo = "Inbox.md";
		inbox.prepend = true;
		const props = createCommandListProps({
			commands: [
				new NestedChoiceCommand(inbox),
				new OpenFileCommand("Projects/Board.md"),
				new UserScript("streaks", "scripts/streaks.js"),
				new WaitCommand(200),
			],
			app,
			plugin: {} as never,
			deleteCommand: vi.fn(),
			saveCommands: vi.fn(),
		});
		const { container } = render(CommandList, { props });

		expect(rows(container)).toEqual([
			["Add to note", "Adds a line at the bottom of Inbox"],
			["Open file: Projects/Board.md", "Opens Projects/Board.md"],
			["streaks", "Runs streaks.js"],
			["Wait", "Waits 200 ms"],
		]);
	});

	it("gives a step it cannot read its name alone", () => {
		const unknown = { id: "u", name: "From a newer version", type: "Teleport" };
		const props = createCommandListProps({
			commands: [unknown as never, new ObsidianCommand("Toggle bold", "editor:toggle-bold")],
			app,
			plugin: {} as never,
			deleteCommand: vi.fn(),
			saveCommands: vi.fn(),
		});
		const { container } = render(CommandList, { props });

		// A line that only repeats the name is left out.
		expect(rows(container)).toEqual([["From a newer version"], ["Toggle bold"]]);
	});

	it("renders a saved command without a name instead of throwing", () => {
		const nameless = { id: "n", name: null, type: CommandType.OpenFile, filePath: "Inbox.md" };
		const props = createCommandListProps({
			commands: [nameless as never],
			app,
			plugin: {} as never,
			deleteCommand: vi.fn(),
			saveCommands: vi.fn(),
		});
		const { container } = render(CommandList, { props });

		expect(container.querySelectorAll(".quickAddCommandListItem")).toHaveLength(1);
	});
});
