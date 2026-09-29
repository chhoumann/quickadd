import { makeProps } from "../../../tests/helpers/settings/commands";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS } from "svelte-dnd-action";
import { tick } from "svelte";

// CommandList transitively imports src/main, which pulls obsidian-dataview's CJS
// require('obsidian'); mock it as the rest of the suite does.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import CommandList from "./CommandList.svelte";
import { ObsidianCommand } from "../../types/macros/ObsidianCommand";
import type { ICommand } from "../../types/macros/ICommand";


const fireDnd = (
	zone: Element,
	type: "consider" | "finalize",
	items: ICommand[],
	trigger: string,
	id: string,
) =>
	fireEvent(
		zone,
		new CustomEvent(type, {
			detail: { items, info: { trigger, id, source: "pointer" } },
		}),
	);

/**
 * #1692 (macro-builder half): handleConsider strips the library's shadow placeholder,
 * whose id is still SHADOW_PLACEHOLDER_ITEM_ID at DRAG_STARTED — so until a later
 * consider re-adds the shadow under the real id, the list is missing the dragged
 * command entirely. A mobile long-press drop inside that window reports finalize items
 * WITHOUT the dragged command; committing that verbatim deleted it. handleSort must
 * fall back to the pre-drag order. See ChoiceList.crosszone.test.ts for the event
 * payload provenance (verified against the real library in E2E mobile emulation).
 */
describe("CommandList placeholder-window drop (#1692)", () => {
	it.each([
		["restores the pre-drag order when the finalize is missing the dragged command", false],
		["commits a genuine reorder untouched after the same drag start", true],
	])("%s", async (_name, reordered) => {
		const a = new ObsidianCommand("Alpha", "a");
		const b = new ObsidianCommand("Beta", "b");
		const c = new ObsidianCommand("Gamma", "c");
		const saveCommands = vi.fn();

		const { container } = render(CommandList, {
			props: makeProps([a, b, c], saveCommands),
		});
		const zone = container.querySelector(".quickAddCommandList") as Element;

		const shadowOfA = { ...a, id: SHADOW_PLACEHOLDER_ITEM_ID } as ICommand;
		await fireDnd(zone, "consider", [shadowOfA, b, c], TRIGGERS.DRAG_STARTED, a.id);
		await fireDnd(zone, "finalize", reordered ? [b, a, c] : [b, c], TRIGGERS.DROPPED_INTO_ZONE, a.id);

		expect(saveCommands).toHaveBeenCalledTimes(1);
		const saved = saveCommands.mock.calls[0][0] as ICommand[];
		expect(saved.map((cmd) => cmd.id)).toEqual(reordered ? [b.id, a.id, c.id] : [a.id, b.id, c.id]);
	});

});

// #1878: a macro without steps hides its empty list, but dragging the only
// command also empties the list for the length of the drag, and the zone must
// stay in place for the drop.
describe("CommandList empty state", () => {
	it("hides the list of a macro without steps", () => {
		const { container } = render(CommandList, { props: makeProps([], vi.fn()) });
		expect(container.querySelector(".quickAddCommandList")?.classList).toContain("is-empty");
	});

	it("keeps the zone while its only command is dragged", async () => {
		const a = new ObsidianCommand("Alpha", "a");
		const { container } = render(CommandList, { props: makeProps([a], vi.fn()) });
		const zone = container.querySelector(".quickAddCommandList") as Element;
		expect(zone.querySelectorAll(".quickAddCommandListItem")).toHaveLength(1);

		const shadowOfA = { ...a, id: SHADOW_PLACEHOLDER_ITEM_ID } as ICommand;
		await fireDnd(zone, "consider", [shadowOfA], TRIGGERS.DRAG_STARTED, a.id);
		expect(zone.querySelectorAll(".quickAddCommandListItem")).toHaveLength(0);
		expect(zone.classList).not.toContain("is-empty");

		await fireDnd(zone, "finalize", [a], TRIGGERS.DROPPED_INTO_ZONE, a.id);
		expect(zone.classList).not.toContain("is-empty");
	});
});

describe("CommandList empty state after a keyboard drag", () => {
	it("hides the list once the last command is gone after a keyboard drag ended", async () => {
		const a = new ObsidianCommand("Alpha", "a");
		const props = makeProps([a], vi.fn());
		const { container } = render(CommandList, { props });
		const zone = container.querySelector(".quickAddCommandList") as Element;

		// A keyboard drag ends with a DRAG_STOPPED consider, not a finalize.
		const keyboard = (trigger: string) =>
			fireEvent(zone, new CustomEvent("consider", {
				detail: { items: [a], info: { trigger, id: a.id, source: "keyboard" } },
			}));
		await keyboard(TRIGGERS.DRAG_STARTED);
		await keyboard(TRIGGERS.DRAG_STOPPED);

		props.commands = [];
		await tick();
		expect(zone.classList).toContain("is-empty");
	});
});
