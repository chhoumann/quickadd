import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settingsStore } from "../settingsStore";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import type IChoice from "../types/choices/IChoice";
import { NoteButtonBlock } from "./NoteButtonBlock";

function capture(id: string, name: string, icon?: string): CaptureChoice {
	const choice = new CaptureChoice(name);
	choice.id = id;
	choice.captureTo = `${name}.md`;
	if (icon) choice.icon = icon;
	return choice;
}

const initial = settingsStore.getState();
let block: NoteButtonBlock | null = null;

function render(source: string, run: (choice: IChoice) => Promise<void> = async () => {}): HTMLElement {
	const el = document.createElement("div");
	block = new NoteButtonBlock(el, source, run);
	block.load();
	return el;
}

const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>("button.qa-note-button")];
const view = (el: HTMLElement) =>
	buttons(el).map((b) => ({
		icon: b.querySelector("svg")?.getAttribute("data-icon") ?? null,
		label: b.textContent,
		title: b.title,
		disabled: b.disabled,
		unresolved: b.classList.contains("is-unresolved"),
	}));

beforeEach(() => {
	settingsStore.setState({
		choices: [capture("log", "Log", "notebook-pen"), capture("task", "Task"), capture("dup1", "Inbox"), capture("dup2", "inbox")],
	});
});

afterEach(() => {
	block?.unload();
	block = null;
	settingsStore.replaceState(initial);
});

describe("NoteButtonBlock", () => {
	it("renders a button per line with the choice's icon, its label, and its summary as the title", () => {
		const el = render("Log | Journal\nid: task\n# a comment\n");
		expect(view(el)).toEqual([
			{ icon: "notebook-pen", label: "Journal", title: "Adds a line at the top of Log", disabled: false, unresolved: false },
			{ icon: "pencil", label: "Task", title: "Adds a line at the top of Task", disabled: false, unresolved: false },
		]);
	});

	it("renders a disabled button saying what is wrong for a line that finds no choice", () => {
		const el = render("Journal\nINBOX\nid: gone\n| Label");
		expect(view(el)).toEqual([
			{ icon: null, label: "No choice named 'Journal'", title: "", disabled: true, unresolved: true },
			{ icon: null, label: "Several choices named 'INBOX'", title: "", disabled: true, unresolved: true },
			{ icon: null, label: "No choice with id 'gone'", title: "", disabled: true, unresolved: true },
			{ icon: null, label: "Can't read '| Label'", title: "", disabled: true, unresolved: true },
		]);
	});

	it("runs the choice once while it runs, and again after it settles", async () => {
		let finish = () => {};
		const run = vi.fn((_choice: IChoice) => new Promise<void>((resolve) => (finish = resolve)));
		const el = render("Log\nTask\nLog | Again", run);
		const [log, task, again] = buttons(el);

		log.click();
		log.click();
		again.click();
		expect(run).toHaveBeenCalledTimes(1);
		expect(run.mock.calls[0][0].id).toBe("log");
		expect([log.disabled, task.disabled, again.disabled]).toEqual([true, false, true]);

		finish();
		await vi.waitFor(() => expect(log.disabled).toBe(false));
		expect(again.disabled).toBe(false);
		log.click();
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("renders again when the choices change, and stops when unloaded", () => {
		const el = render("Log\nid: task");
		settingsStore.setState({ choices: [capture("log", "Journal entry"), capture("task", "Chore")] });
		expect(view(el).map((b) => b.label)).toEqual(["No choice named 'Log'", "Chore"]);

		block?.unload();
		settingsStore.setState({ choices: [capture("log", "Log"), capture("task", "Errand")] });
		expect(view(el).map((b) => b.label)).toEqual(["No choice named 'Log'", "Chore"]);
	});

	it("keeps the same buttons when a change leaves them as they are", () => {
		const el = render("Log");
		const [before] = buttons(el);
		settingsStore.setState({ choices: [...settingsStore.getState().choices, capture("new", "New")] });
		expect(buttons(el)[0]).toBe(before);
	});
});
