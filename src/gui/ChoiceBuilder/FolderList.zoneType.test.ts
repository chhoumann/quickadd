import { describe, expect, it, vi } from "vitest";
import type * as DndAction from "svelte-dnd-action";

/**
 * Two template builders can be open at once (nested choice inside a macro).
 * svelte-dnd-action groups drop zones by `type` and hit-tests every zone in the
 * group geometrically, so a shared `folder` type would let one list steal a
 * drop from the other. The type is invisible in the DOM; wrap `dndzone` and
 * record the options each list registers with.
 *
 * Own file because `vi.mock` is module-graph-wide.
 */

const registeredTypes: (string | undefined)[] = [];

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
import FolderList from "./FolderList.svelte";

describe("FolderList's drop-zone type", () => {
	it("is unique per list, so two folder lists are never targets for each other", () => {
		registeredTypes.length = 0;

		render(FolderList, {
			props: { folders: ["Notes"], onChange: vi.fn() },
		});
		render(FolderList, {
			props: { folders: ["Daily"], onChange: vi.fn() },
		});

		expect(registeredTypes).toHaveLength(2);
		expect(registeredTypes).not.toContain("folder");
		expect(registeredTypes[0]).not.toBe(registeredTypes[1]);
		for (const type of registeredTypes) {
			expect(type).toMatch(/^folder:/);
		}
	});
});
