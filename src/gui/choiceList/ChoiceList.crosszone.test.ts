import { actionsSpy } from "../../../tests/helpers/settings/choiceActions";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS } from "svelte-dnd-action";

// ChoiceListItem -> renderChoiceName/contextMenu reach src/main -> obsidian-dataview.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

// jsdom lacks the Web Animations API that svelte's animate:flip touches when a keyed
// {#each} removes a row (the cross-zone strip below). Stub it so the reorder doesn't throw.
beforeAll(() => {
	const proto = Element.prototype as unknown as {
		getAnimations?: () => unknown[];
		animate?: () => unknown;
	};
	if (!proto.getAnimations) proto.getAnimations = () => [];
	if (!proto.animate)
		proto.animate = () => ({ cancel() {}, finished: Promise.resolve() });
});

import { App } from "obsidian";
import ChoiceList from "./ChoiceList.svelte";
import type IChoice from "../../types/choices/IChoice";

const normal = (name: string): IChoice =>
	({ id: name, name, type: "Template", command: false }) as unknown as IChoice;


const committedIds = (fn: unknown): string[] =>
	((fn as { mock: { calls: unknown[][] } }).mock.calls[0][0] as IChoice[]).map(
		(c) => c.id,
	);

function fireDnd(
	zone: Element,
	type: "consider" | "finalize",
	items: IChoice[],
	trigger: string,
	id: string,
) {
	return fireEvent(zone, new CustomEvent(type, {
		detail: { items, info: { trigger, id, source: "pointer" } },
	}));
}

function mountList(names = ["A", "B", "C"]) {
	const actions = actionsSpy();
	const choices = names.map(normal);
	const { container } = render(ChoiceList, {
		props: { app: new App(), roots: choices, choices, actions },
	});
	return { actions, zone: container.querySelector(".choiceList")! };
}

describe("ChoiceList cross-zone de-dup (handleSort)", () => {
	it.each([
		{
			name: "strips the dragged item from the SOURCE list on DROPPED_INTO_ANOTHER",
			items: ["A", "B", "C"], trigger: TRIGGERS.DROPPED_INTO_ANOTHER, expected: ["A", "C"],
		},
		{
			name: "keeps every item on a same-zone reorder (DROPPED_INTO_ZONE)",
			items: ["B", "A", "C"], trigger: TRIGGERS.DROPPED_INTO_ZONE, expected: ["B", "A", "C"],
		},
		{
			name: "is a no-op strip when the library already removed the item from the source",
			items: ["A", "C"], trigger: TRIGGERS.DROPPED_INTO_ANOTHER, expected: ["A", "C"],
		},
	])("$name", async ({ items, trigger, expected }) => {
		const { actions, zone } = mountList();
		await fireDnd(zone, "finalize", items.map(normal), trigger, "B");
		expect(actions.onReorderChoices).toHaveBeenCalledTimes(1);
		expect(committedIds(actions.onReorderChoices)).toEqual(expected);
	});
});

// A placeholder-window drop can omit the dragged item before its real id returns.
// These payloads cover origin recovery, moved placeholders, and destination recovery.
describe("ChoiceList placeholder-window drop (#1692)", () => {
	const shadow = { ...normal("A"), id: SHADOW_PLACEHOLDER_ITEM_ID, isDndShadowItem: true };
	const items = (names: string[]) => names.map((name) => name === "shadow" ? shadow : normal(name));

	it.each([
		{
			name: "restores the pre-drag order when the finalize is missing the dragged choice",
			initial: ["A", "B", "C"], considers: [["shadow", "B", "C"]],
			final: ["B", "C"], trigger: TRIGGERS.DROPPED_INTO_ZONE, expected: ["A", "B", "C"],
		},
		{
			name: "re-inserts at the index the stripped placeholder last held (fast move into the window)",
			initial: ["A", "B", "C"], considers: [["shadow", "B", "C"], ["B", "C", "shadow"]],
			final: ["B", "C"], trigger: TRIGGERS.DROPPED_INTO_ZONE, expected: ["B", "C", "A"],
		},
		{
			name: "recovers in the DESTINATION zone of a cross-zone drop, sans the library marker",
			initial: ["X", "Y"], considers: [["X", "shadow", "Y"]],
			final: ["X", "Y"], trigger: TRIGGERS.DROPPED_INTO_ZONE, expected: ["X", "A", "Y"],
		},
		{
			name: "commits a genuine reorder untouched after the same drag start",
			initial: ["A", "B", "C"], considers: [["shadow", "B", "C"]],
			final: ["B", "A", "C"], trigger: TRIGGERS.DROPPED_INTO_ZONE, expected: ["B", "A", "C"],
		},
		{
			name: "still strips the dragged choice on DROPPED_INTO_ANOTHER after a drag start",
			initial: ["A", "B", "C"], considers: [["shadow", "B", "C"]],
			final: ["A", "B", "C"], trigger: TRIGGERS.DROPPED_INTO_ANOTHER, expected: ["B", "C"],
		},
	])("$name", async ({ initial, considers, final, trigger, expected }) => {
		const { actions, zone } = mountList(initial);
		for (const [index, names] of considers.entries()) {
			const startedHere = initial.includes("A") && index === 0;
			await fireDnd(zone, "consider", items(names), startedHere ? TRIGGERS.DRAG_STARTED : TRIGGERS.DRAGGED_ENTERED, "A");
		}
		await fireDnd(zone, "finalize", items(final), trigger, "A");
		expect(committedIds(actions.onReorderChoices)).toEqual(expected);
		if (!initial.includes("A")) {
			const committed = vi.mocked(actions.onReorderChoices).mock.calls[0][0];
			expect(committed[1]).not.toHaveProperty("isDndShadowItem");
		}
	});
});
