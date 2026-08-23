import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS } from "svelte-dnd-action";

// CommandList transitively imports src/main, which pulls obsidian-dataview's CJS
// require('obsidian'); mock it as the rest of the suite does.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import CommandList from "./CommandList.svelte";
import { createCommandListProps } from "./commandListProps.svelte";
import { ObsidianCommand } from "../../types/macros/ObsidianCommand";
import type { ICommand } from "../../types/macros/ICommand";

const makeProps = (commands: ICommand[], saveCommands = vi.fn()) =>
	createCommandListProps({
		commands,
		app: new App() as never,
		plugin: {} as never,
		deleteCommand: vi.fn(),
		saveCommands,
	});

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
	it("restores the pre-drag order when the finalize is missing the dragged command", async () => {
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
		await fireDnd(zone, "finalize", [b, c], TRIGGERS.DROPPED_INTO_ZONE, a.id);

		expect(saveCommands).toHaveBeenCalledTimes(1);
		const saved = saveCommands.mock.calls[0][0] as ICommand[];
		expect(saved.map((cmd) => cmd.id)).toEqual([a.id, b.id, c.id]);
	});

	it("commits a genuine reorder untouched after the same drag start", async () => {
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
		await fireDnd(zone, "finalize", [b, a, c], TRIGGERS.DROPPED_INTO_ZONE, a.id);

		expect(saveCommands).toHaveBeenCalledTimes(1);
		const saved = saveCommands.mock.calls[0][0] as ICommand[];
		expect(saved.map((cmd) => cmd.id)).toEqual([b.id, a.id, c.id]);
	});
});
