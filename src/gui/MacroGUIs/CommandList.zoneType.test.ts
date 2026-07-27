import { describe, expect, it, vi } from "vitest";
import type * as DndAction from "svelte-dnd-action";

/**
 * #1613. The macro builder and the conditional-branch editor both mount a
 * CommandList, and the branch modal opens ON TOP of the still-open builder.
 * svelte-dnd-action groups drop zones by `type` and hit-tests every zone in the
 * group GEOMETRICALLY - a modal backdrop shields nothing - so while both lists
 * shared `type: "command"`, dragging a command a little too far down inside the
 * branch editor dropped it into the builder underneath.
 *
 * The zone type is the whole fix, and it is invisible in the DOM: the library
 * writes no attribute for it. Its `dndzone` action is the only observable seam,
 * so this test WRAPS the real action (rather than stubbing it, which would lose
 * the behaviour under test) and records the options each list registers with.
 *
 * Its own file because `vi.mock` is module-graph-wide, and a stray mock of
 * svelte-dnd-action would leak into the other CommandList tests.
 */

const registeredTypes: (string | undefined)[] = [];

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

vi.mock("svelte-dnd-action", async () => {
	const actual = await vi.importActual<typeof DndAction>("svelte-dnd-action");
	return {
		...actual,
		dndzone: (node: HTMLElement, options: { type?: string }) => {
			registeredTypes.push(options?.type);
			return actual.dndzone(node, options as never);
		},
	};
});

import { render } from "@testing-library/svelte";
import { App } from "obsidian";
import CommandList from "./CommandList.svelte";
import type QuickAdd from "../../main";
import type { ICommand } from "../../types/macros/ICommand";

const wait = (id: string): ICommand =>
	({ id, name: "Wait", type: "Wait", time: 100 }) as unknown as ICommand;

const renderList = (commands: ICommand[]) =>
	render(CommandList, {
		props: {
			commands,
			app: new App() as never,
			plugin: {} as unknown as QuickAdd,
			deleteCommand: vi.fn(),
			saveCommands: vi.fn(),
		} as never,
	});

describe("CommandList's drop-zone type", () => {
	it("is unique per list, so two command lists are never targets for each other", () => {
		registeredTypes.length = 0;

		renderList([wait("a")]);
		renderList([wait("b")]);

		expect(registeredTypes).toHaveLength(2);
		// The literal that used to be shared. Any two lists carrying it are in the
		// same group and hit-test each other.
		expect(registeredTypes).not.toContain("command");
		expect(registeredTypes[0]).not.toBe(registeredTypes[1]);
		for (const type of registeredTypes) {
			expect(type).toMatch(/^command:/);
		}
	});
});
