import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { TRIGGERS } from "svelte-dnd-action";

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
		onToggleShareMenu: vi.fn(),
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
