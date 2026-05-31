import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";

// ChoiceListItem -> renderChoiceName/contextMenu reach src/main -> obsidian-dataview.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App, Menu } from "obsidian";
// Runtime "obsidian" is aliased to the test stub (vitest.config.mts); tsc/svelte-check
// resolve the real obsidian types, which don't know the stub's recording fields. Cast
// through the stub's type to read them in a type-safe way.
import type { Menu as StubMenu } from "../../../tests/obsidian-stub";
import ChoiceList from "./ChoiceList.svelte";
import type IChoice from "../../types/choices/IChoice";
import type { ChoiceListActions } from "./choiceListActions";

const ShownMenu = Menu as unknown as typeof StubMenu;

const normal = (name: string): IChoice =>
	({ id: name, name, type: "Template", command: false }) as unknown as IChoice;
const multi = (name: string, children: IChoice[], collapsed = false): IChoice =>
	({
		id: name,
		name,
		type: "Multi",
		command: false,
		collapsed,
		choices: children,
	}) as unknown as IChoice;

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

const idsOf = (fn: unknown) =>
	((fn as { mock: { calls: unknown[][] } }).mock.calls[0][0] as IChoice[]).map((c) => c.id);

beforeEach(() => {
	ShownMenu.lastShown = null;
});

describe("ChoiceList keyboard reorder", () => {
	it("ArrowDown on a row's drag handle reorders that list and persists", async () => {
		const actions = actionsSpy();
		const choices = [normal("Alpha"), normal("Beta"), normal("Gamma")];
		const { getByLabelText } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});

		await fireEvent.keyDown(getByLabelText("Reorder Alpha"), { key: "ArrowDown" });

		expect(actions.onReorderChoices).toHaveBeenCalledTimes(1);
		expect(idsOf(actions.onReorderChoices)).toEqual(["Beta", "Alpha", "Gamma"]);
	});

	it("clamps at the ends — ArrowUp on the first row is a no-op", async () => {
		const actions = actionsSpy();
		const choices = [normal("Alpha"), normal("Beta")];
		const { getByLabelText } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});

		await fireEvent.keyDown(getByLabelText("Reorder Alpha"), { key: "ArrowUp" });
		expect(actions.onReorderChoices).not.toHaveBeenCalled();
	});

	it("never reorders a filtered/derived list (forceDragDisabled)", async () => {
		const actions = actionsSpy();
		const choices = [normal("Alpha"), normal("Beta")];
		const { getByLabelText } = render(ChoiceList, {
			props: {
				app: new App() as never,
				roots: choices,
				choices,
				actions,
				forceDragDisabled: true,
			},
		});

		await fireEvent.keyDown(getByLabelText("Reorder Alpha"), { key: "ArrowDown" });
		expect(actions.onReorderChoices).not.toHaveBeenCalled();
		// The inert handle must not advertise a keyboard shortcut that does nothing.
		expect(getByLabelText("Reorder Alpha").hasAttribute("aria-keyshortcuts")).toBe(false);
	});

	it("reorders a doubly-nested Multi's children WITHOUT corrupting ancestors (depth >= 2)", async () => {
		// Regression for the nestedActions bubbling bug: an inner Multi must not push
		// the root array into its parent Multi's onReorderChoices override.
		const actions = actionsSpy();
		const c1 = normal("c1");
		const c2 = normal("c2");
		const inner = multi("Inner", [c1, c2]);
		const outer = multi("Outer", [inner]);
		const choices = [outer];
		const { getByLabelText } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});

		await fireEvent.keyDown(getByLabelText("Reorder c1"), { key: "ArrowDown" });

		// The nested reorder edits Inner's children IN PLACE then commits by id via
		// onCommitFolder (NOT onReorderChoices, which an ancestor Multi overrides) —
		// the same path a cross-zone drag takes; see the duplication fix.
		expect(actions.onCommitFolder).toHaveBeenCalledTimes(1);
		expect(
			(actions.onCommitFolder as ReturnType<typeof vi.fn>).mock.calls[0],
		).toEqual(["Inner", [c2, c1]]);
		expect(actions.onReorderChoices).not.toHaveBeenCalled();
		// Inner's children reordered; ancestors intact (no depth >= 2 corruption).
		expect(
			(inner as unknown as { choices: IChoice[] }).choices.map((c) => c.id),
		).toEqual(["c2", "c1"]);
		expect(
			(outer as unknown as { choices: IChoice[] }).choices.map((c) => c.id),
		).toEqual(["Inner"]);
		expect(choices.map((c) => c.id)).toEqual(["Outer"]);
	});
});

describe("ChoiceList drag arming", () => {
	// Regression for the "can't click to toggle folders" bug: pressing the drag
	// handle arms the zone (dragDisabled -> false), but a press that never becomes a
	// real drag must disarm on release. Otherwise svelte-dnd-action keeps owning the
	// rows and SWALLOWS their button clicks (the Multi collapse toggle, etc).
	it("disarms on pointerup when the handle was pressed but never dragged", async () => {
		const actions = actionsSpy();
		const group = multi("Group", [normal("Child")]);
		const { getByLabelText } = render(ChoiceList, {
			props: { app: new App() as never, roots: [group], choices: [group], actions },
		});

		const handle = getByLabelText("Reorder Group");
		// Inert to start: zone not draggable, so row clicks pass through.
		expect(handle.classList.contains("qa-drag-handle-ready")).toBe(true);

		// Press the handle -> the zone arms (becomes draggable).
		await fireEvent.pointerDown(handle);
		expect(handle.classList.contains("qa-drag-handle-active")).toBe(true);

		// Release without ever dragging (no `consider` fires) -> must disarm.
		await fireEvent.pointerUp(window);
		expect(handle.classList.contains("qa-drag-handle-active")).toBe(false);
		expect(handle.classList.contains("qa-drag-handle-ready")).toBe(true);
	});
});

describe("MultiChoiceListItem collapse toggle", () => {
	it("is a native button exposing aria-expanded=true and the nested list when expanded", () => {
		const actions = actionsSpy();
		const group = multi("Group", [normal("Child")], false);
		const { getByLabelText, queryByLabelText } = render(ChoiceList, {
			props: { app: new App() as never, roots: [group], choices: [group], actions },
		});

		const toggle = getByLabelText("Toggle Group");
		expect(toggle.tagName).toBe("BUTTON");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(queryByLabelText("Delete Child")).not.toBeNull();
	});

	it("exposes aria-expanded=false and hides the nested list when collapsed", () => {
		const actions = actionsSpy();
		const group = multi("Group", [normal("Child")], true);
		const { getByLabelText, queryByLabelText } = render(ChoiceList, {
			props: { app: new App() as never, roots: [group], choices: [group], actions },
		});

		const toggle = getByLabelText("Toggle Group");
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(queryByLabelText("Delete Child")).toBeNull();
	});
});

describe("ChoiceList mobile collapse hooks", () => {
	// On mobile the per-row action icons are hidden via CSS (.is-mobile
	// .qa-row-secondary-action) and reached through the More menu; the More button
	// and drag handle stay. Guard that the right buttons carry the collapse class.
	it("tags the secondary action buttons but not More / drag handle", () => {
		const actions = actionsSpy();
		const choices = [normal("Alpha")];
		const { getByLabelText } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});

		const secondary = "qa-row-secondary-action";
		for (const label of [
			"Command palette: Alpha",
			"Configure Alpha",
			"Duplicate Alpha",
			"Delete Alpha",
		]) {
			expect(getByLabelText(label).classList.contains(secondary)).toBe(true);
		}
		expect(getByLabelText("More options for Alpha").classList.contains(secondary)).toBe(false);
		expect(getByLabelText("Reorder Alpha").classList.contains(secondary)).toBe(false);
	});
});

describe("ChoiceList keyboard-accessible context menu", () => {
	it("opens the context menu anchored to the More-options button (no mouse needed)", async () => {
		const actions = actionsSpy();
		const choices = [normal("Alpha")];
		const { getByLabelText } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});

		await fireEvent.click(getByLabelText("More options for Alpha"));

		expect(ShownMenu.lastShown).not.toBeNull();
		// Anchored via showAtPosition (keyboard path), not showAtMouseEvent.
		expect(ShownMenu.lastShown?.shownAt?.type).toBe("position");

		// Rename is otherwise menu-only — confirm it is reachable here and wired.
		const rename = ShownMenu.lastShown?.items.find((i) => i.title === "Rename");
		expect(rename).toBeDefined();
		rename?.clickHandler?.();
		expect(actions.onRenameChoice).toHaveBeenCalledTimes(1);
	});
});
