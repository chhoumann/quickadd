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
import type { ChoiceListActions } from "./choiceListActions";

const normal = (name: string): IChoice =>
	({ id: name, name, type: "Template", command: false }) as unknown as IChoice;

function actionsSpy(): ChoiceListActions {
	return {
		onDeleteChoice: vi.fn(),
		onConfigureChoice: vi.fn(),
		onToggleCommand: vi.fn(),
		onDuplicateChoice: vi.fn(),
		onRenameChoice: vi.fn(),
		onMoveChoice: vi.fn(),
		onReorderChoices: vi.fn(),
		onAddChoice: vi.fn(),
		onToggleCollapsed: vi.fn(),
		onCommitFolder: vi.fn(),
	};
}

const committedIds = (fn: unknown): string[] =>
	((fn as { mock: { calls: unknown[][] } }).mock.calls[0][0] as IChoice[]).map(
		(c) => c.id,
	);

/** Dispatch the dndzone `finalize` CustomEvent the library emits on drop. */
function fireFinalize(
	zone: Element,
	items: IChoice[],
	trigger: string,
	id: string,
): Promise<unknown> {
	return fireEvent(
		zone,
		new CustomEvent("finalize", {
			detail: { items, info: { trigger, id, source: "pointer" } },
		}),
	);
}

/** Dispatch the dndzone `consider` CustomEvent the library emits mid-drag. */
function fireConsider(
	zone: Element,
	items: IChoice[],
	trigger: string,
	id: string,
): Promise<unknown> {
	return fireEvent(
		zone,
		new CustomEvent("consider", {
			detail: { items, info: { trigger, id, source: "pointer" } },
		}),
	);
}

/**
 * The root<->folder de-dup has TWO co-dependent halves: (1) the by-id commit
 * (onCommitFolder -> setFolderChildrenById) — covered by the nested-reorder test in
 * ChoiceList.a11y.test.ts — and (2) THIS: stripping the dragged item from the SOURCE
 * list on DROPPED_INTO_ANOTHER, because svelte-dnd-action can still report the dragged
 * item in the origin zone's items, which would otherwise persist a copy in both places.
 * Real pointer drags can't run in jsdom, so we drive the finalize events directly.
 */
describe("ChoiceList cross-zone de-dup (handleSort)", () => {
	it("strips the dragged item from the SOURCE list on DROPPED_INTO_ANOTHER", async () => {
		const actions = actionsSpy();
		const choices = [normal("A"), normal("B"), normal("C")];
		const { container } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});
		const zone = container.querySelector(".choiceList") as Element;

		// B was dragged into ANOTHER zone, yet the library still reports it here.
		await fireFinalize(
			zone,
			[normal("A"), normal("B"), normal("C")],
			TRIGGERS.DROPPED_INTO_ANOTHER,
			"B",
		);

		expect(actions.onReorderChoices).toHaveBeenCalledTimes(1);
		expect(committedIds(actions.onReorderChoices)).toEqual(["A", "C"]); // B removed
	});

	it("keeps every item on a same-zone reorder (DROPPED_INTO_ZONE)", async () => {
		const actions = actionsSpy();
		const choices = [normal("A"), normal("B"), normal("C")];
		const { container } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});
		const zone = container.querySelector(".choiceList") as Element;

		await fireFinalize(
			zone,
			[normal("B"), normal("A"), normal("C")],
			TRIGGERS.DROPPED_INTO_ZONE,
			"B",
		);

		// A reorder must NOT strip the dragged item — only DROPPED_INTO_ANOTHER does.
		expect(committedIds(actions.onReorderChoices)).toEqual(["B", "A", "C"]);
	});

	it("is a no-op strip when the library already removed the item from the source", async () => {
		const actions = actionsSpy();
		const choices = [normal("A"), normal("B"), normal("C")];
		const { container } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});
		const zone = container.querySelector(".choiceList") as Element;

		// Origin already excludes B; the strip must not drop anything else.
		await fireFinalize(
			zone,
			[normal("A"), normal("C")],
			TRIGGERS.DROPPED_INTO_ANOTHER,
			"B",
		);

		expect(committedIds(actions.onReorderChoices)).toEqual(["A", "C"]);
	});
});

/**
 * #1692: the placeholder-window drop. handleConsider strips the library's shadow
 * placeholder, whose id is still SHADOW_PLACEHOLDER_ITEM_ID at DRAG_STARTED (and on
 * the first synchronous DRAGGED_ENTERED) — so until a later consider re-adds the
 * shadow under the real id, the list is missing the dragged choice entirely. Mobile
 * long-press drags start stationary and routinely drop inside that window (hold-and-
 * release, a small nudge, or a touchend before the next ~20ms observation tick), and
 * the finalize then reports items WITHOUT the dragged choice. Committing that verbatim
 * deleted the choice on Android. handleSort must fall back to the pre-drag order.
 * Event payloads mirror a real drag, verified against svelte-dnd-action 0.9.78 in the
 * E2E Obsidian instance under mobile emulation.
 */
describe("ChoiceList placeholder-window drop (#1692)", () => {
	const shadowOf = (choice: IChoice): IChoice =>
		({
			...choice,
			id: SHADOW_PLACEHOLDER_ITEM_ID,
			isDndShadowItem: true,
		}) as IChoice;

	it("restores the pre-drag order when the finalize is missing the dragged choice", async () => {
		const actions = actionsSpy();
		const choices = [normal("A"), normal("B"), normal("C")];
		const { container } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});
		const zone = container.querySelector(".choiceList") as Element;

		// Long-press drag start: the library replaces A with its placeholder shadow.
		await fireConsider(
			zone,
			[shadowOf(normal("A")), normal("B"), normal("C")],
			TRIGGERS.DRAG_STARTED,
			"A",
		);
		// Drop before any index-change consider: A is gone from the reported items.
		await fireFinalize(
			zone,
			[normal("B"), normal("C")],
			TRIGGERS.DROPPED_INTO_ZONE,
			"A",
		);

		expect(committedIds(actions.onReorderChoices)).toEqual(["A", "B", "C"]);
	});

	it("re-inserts at the index the stripped placeholder last held (fast move into the window)", async () => {
		const actions = actionsSpy();
		const choices = [normal("A"), normal("B"), normal("C")];
		const { container } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});
		const zone = container.querySelector(".choiceList") as Element;

		await fireConsider(
			zone,
			[shadowOf(normal("A")), normal("B"), normal("C")],
			TRIGGERS.DRAG_STARTED,
			"A",
		);
		// The first DRAGGED_ENTERED (still placeholder-id: it fires before the
		// library swaps in the real id) already reports the user's new position.
		await fireConsider(
			zone,
			[normal("B"), normal("C"), shadowOf(normal("A"))],
			TRIGGERS.DRAGGED_ENTERED,
			"A",
		);
		await fireFinalize(
			zone,
			[normal("B"), normal("C")],
			TRIGGERS.DROPPED_INTO_ZONE,
			"A",
		);

		// The reorder the user made inside the window is preserved, not reverted.
		expect(committedIds(actions.onReorderChoices)).toEqual(["B", "C", "A"]);
	});

	it("recovers in the DESTINATION zone of a cross-zone drop, sans the library marker", async () => {
		const actions = actionsSpy();
		// This zone never saw DRAG_STARTED: the drag began in another zone.
		const choices = [normal("X"), normal("Y")];
		const { container } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});
		const zone = container.querySelector(".choiceList") as Element;

		// The dragged item enters while its shadow still has the placeholder id.
		await fireConsider(
			zone,
			[normal("X"), shadowOf(normal("A")), normal("Y")],
			TRIGGERS.DRAGGED_ENTERED,
			"A",
		);
		await fireFinalize(zone, [normal("X"), normal("Y")], TRIGGERS.DROPPED_INTO_ZONE, "A");

		expect(committedIds(actions.onReorderChoices)).toEqual(["X", "A", "Y"]);
		const committed = (actions.onReorderChoices as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as Record<string, unknown>[];
		// The recovered item is rebuilt from the shadow payload; the library's
		// marker must not leak into state (it would persist into data.json).
		expect(committed[1]).not.toHaveProperty("isDndShadowItem");
	});

	it("commits a genuine reorder untouched after the same drag start", async () => {
		const actions = actionsSpy();
		const choices = [normal("A"), normal("B"), normal("C")];
		const { container } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});
		const zone = container.querySelector(".choiceList") as Element;

		await fireConsider(
			zone,
			[shadowOf(normal("A")), normal("B"), normal("C")],
			TRIGGERS.DRAG_STARTED,
			"A",
		);
		await fireFinalize(
			zone,
			[normal("B"), normal("A"), normal("C")],
			TRIGGERS.DROPPED_INTO_ZONE,
			"A",
		);

		expect(committedIds(actions.onReorderChoices)).toEqual(["B", "A", "C"]);
	});

	it("still strips the dragged choice on DROPPED_INTO_ANOTHER after a drag start", async () => {
		const actions = actionsSpy();
		const choices = [normal("A"), normal("B"), normal("C")];
		const { container } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});
		const zone = container.querySelector(".choiceList") as Element;

		await fireConsider(
			zone,
			[shadowOf(normal("A")), normal("B"), normal("C")],
			TRIGGERS.DRAG_STARTED,
			"A",
		);
		// The drop landed in another zone; the snapshot must NOT resurrect A here.
		await fireFinalize(
			zone,
			[normal("A"), normal("B"), normal("C")],
			TRIGGERS.DROPPED_INTO_ANOTHER,
			"A",
		);

		expect(committedIds(actions.onReorderChoices)).toEqual(["B", "C"]);
	});
});
