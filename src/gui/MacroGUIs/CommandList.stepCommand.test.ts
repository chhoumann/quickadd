import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { App } from "obsidian";
import CommandList from "./CommandList.svelte";
import { createCommandListProps } from "./commandListProps.svelte";
import type { ICommand } from "../../types/macros/ICommand";
import { CommandType } from "../../types/macros/CommandType";
import { newStep } from "../../v3/addStep";
import { lowerStep } from "../../v3/lower";
import type { OpenStep } from "../../v3/model";

vi.mock("../../quickAddInstance", () => ({ getQuickAddInstance: vi.fn(() => ({})) }));

const app = new App();
app.vault.getMarkdownFiles = () => [];

/** Each row of the list: its name, then what it says under it. */
function rows(container: HTMLElement): string[][] {
	return Array.from(container.querySelectorAll(".quickAddCommandListItem"), (row) =>
		Array.from(row.querySelectorAll(".quickAddCommandLabel, .quickAddCommandDetail"), (el) => el.textContent?.trim() ?? ""),
	);
}

function renderList(commands: ICommand[]) {
	const saveCommands = vi.fn();
	const props = createCommandListProps({ commands, app, plugin: {} as never, deleteCommand: vi.fn(), saveCommands });
	const { container } = render(CommandList, { props });
	return { container, saveCommands };
}

/** The modal on top: the last one opened. */
const modal = () => Array.from(document.body.querySelectorAll<HTMLElement>(".quickAddModal")).at(-1) as HTMLElement;

function button(root: HTMLElement, text: string): HTMLButtonElement {
	const found = Array.from(root.querySelectorAll("button")).find((el) => el.textContent?.trim() === text);
	if (!found) throw new Error(`No button '${text}'`);
	return found;
}

function toggle(root: HTMLElement, label: string): HTMLElement {
	const found = root.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);
	if (!found) throw new Error(`No toggle '${label}'`);
	return found;
}

async function configure(container: HTMLElement, name: string) {
	const gear = container.querySelector<HTMLElement>(`[aria-label="Configure ${name}"]`);
	if (!gear) throw new Error(`No configure button for '${name}'`);
	await fireEvent.click(gear);
	await tick();
}

describe("a step with no v2 command form", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("shows a link step as a row that says what it does, with its settings behind the gear", async () => {
		const link = lowerStep(newStep("link"), "");
		const { container, saveCommands } = renderList([link]);
		expect(rows(container)).toEqual([["Link it", "Links it on a new line here"]]);

		await configure(container, "Link it");
		expect(modal().querySelector(".qa-modal-title")?.textContent).toBe("Link it");
		expect(toggle(modal(), "Insert").getAttribute("aria-checked")).toBe("true");
		await fireEvent.click(toggle(modal(), "Copy to clipboard"));
		await fireEvent.click(button(modal(), "Save"));
		await tick();

		const [saved] = saveCommands.mock.lastCall?.[0] as ICommand[];
		expect(saved).toMatchObject({
			id: link.id,
			type: "v3-step",
			step: { type: "link", link: "{{NOTE}}", insert: { placement: "newLine", requireActiveFile: false }, copyToClipboard: true },
		});
		expect(rows(container)).toEqual([["Link it", "Links it on a new line here and copies its link"]]);
	});

	it("drops the insert when Insert is turned off, and keeps what Cancel leaves", async () => {
		const { container, saveCommands } = renderList([lowerStep(newStep("link"), "")]);

		await configure(container, "Link it");
		await fireEvent.click(toggle(modal(), "Insert"));
		await fireEvent.click(button(modal(), "Cancel"));
		await tick();
		expect(saveCommands).not.toHaveBeenCalled();

		await configure(container, "Link it");
		await fireEvent.click(toggle(modal(), "Insert"));
		await fireEvent.click(toggle(modal(), "Copy to clipboard"));
		await fireEvent.click(button(modal(), "Save"));
		await tick();

		const [saved] = saveCommands.mock.lastCall?.[0] as { step: object }[];
		expect(saved.step).not.toHaveProperty("insert");
		expect(rows(container)).toEqual([["Link it", "Copies its link"]]);
	});

	it("runs Templater on the note its settings name", async () => {
		const { container, saveCommands } = renderList([lowerStep(newStep("templater"), "")]);
		expect(rows(container)).toEqual([["Run Templater", "Runs Templater on it"]]);

		await configure(container, "Run Templater");
		const note = modal().querySelector<HTMLInputElement>('input[aria-label="Note"]') as HTMLInputElement;
		expect(note.value).toBe("{{NOTE}}");
		await fireEvent.input(note, { target: { value: "Projects/Board.md" } });
		await fireEvent.click(button(modal(), "Save"));
		await tick();

		expect(saveCommands.mock.lastCall?.[0][0].step).toMatchObject({ type: "templater", note: "Projects/Board.md" });
		expect(rows(container)).toEqual([["Run Templater", "Runs Templater on Projects/Board.md"]]);
	});

	it("keeps an open in a view mode a step, and an open as saved the Open file command", async () => {
		const open: OpenStep = { ...(newStep("open") as OpenStep), mode: "preview" };
		const { container, saveCommands } = renderList([lowerStep(open, "")]);
		expect(rows(container)).toEqual([["Open the note", "Opens it"]]);

		await configure(container, "Open the note");
		const view = Array.from(modal().querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.textContent === "Reading view"),
		) as HTMLSelectElement;
		expect(view.value).toBe("preview");
		view.value = "default";
		await fireEvent.change(view);
		await fireEvent.click(button(modal(), "Save"));
		await tick();

		expect(saveCommands.mock.lastCall?.[0][0]).toMatchObject({ id: open.id, type: CommandType.OpenFile, filePath: "{{NOTE}}" });
	});
});
