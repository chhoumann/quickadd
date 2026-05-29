import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";

import DragHandle from "./DragHandle.svelte";

describe("DragHandle", () => {
	it("is a focusable native button advertising arrow reorder when handlers are provided", () => {
		const { getByLabelText } = render(DragHandle, {
			props: {
				label: "Reorder Alpha",
				dragDisabled: true,
				onDragStart: () => {},
				onMoveUp: () => {},
				onMoveDown: () => {},
			},
		});
		const btn = getByLabelText("Reorder Alpha");
		expect(btn.tagName).toBe("BUTTON");
		expect(btn.getAttribute("tabindex")).toBe("0");
		expect(btn.getAttribute("aria-keyshortcuts")).toBe("ArrowUp ArrowDown");
	});

	it("does not advertise or handle arrow reorder when no move handlers are given (e.g. filtered view)", async () => {
		const { getByLabelText } = render(DragHandle, {
			props: { label: "Reorder Alpha", dragDisabled: true, onDragStart: () => {} },
		});
		const btn = getByLabelText("Reorder Alpha");
		expect(btn.hasAttribute("aria-keyshortcuts")).toBe(false);
		// Arrow keys are not intercepted (no preventDefault) when inert.
		const down = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true, bubbles: true });
		btn.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(false);
	});

	it("is taken out of the tab order while an active pointer drag is in progress", () => {
		const { getByLabelText } = render(DragHandle, {
			props: { label: "Reorder Alpha", dragDisabled: false, onDragStart: () => {} },
		});
		expect(getByLabelText("Reorder Alpha").getAttribute("tabindex")).toBe("-1");
	});

	it("starts a pointer drag on pointerdown", async () => {
		const onDragStart = vi.fn();
		const { getByLabelText } = render(DragHandle, {
			props: { label: "Reorder Alpha", dragDisabled: true, onDragStart },
		});
		await fireEvent.pointerDown(getByLabelText("Reorder Alpha"));
		expect(onDragStart).toHaveBeenCalledTimes(1);
	});

	it("moves the row with ArrowUp / ArrowDown and prevents page scroll", async () => {
		const onMoveUp = vi.fn();
		const onMoveDown = vi.fn();
		const { getByLabelText } = render(DragHandle, {
			props: {
				label: "Reorder Alpha",
				dragDisabled: true,
				onDragStart: () => {},
				onMoveUp,
				onMoveDown,
			},
		});
		const btn = getByLabelText("Reorder Alpha");

		const down = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true, bubbles: true });
		btn.dispatchEvent(down);
		expect(onMoveDown).toHaveBeenCalledTimes(1);
		expect(down.defaultPrevented).toBe(true);

		const up = new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true, bubbles: true });
		btn.dispatchEvent(up);
		expect(onMoveUp).toHaveBeenCalledTimes(1);
		expect(up.defaultPrevented).toBe(true);
	});

	it("ignores other keys", async () => {
		const onMoveUp = vi.fn();
		const onMoveDown = vi.fn();
		const { getByLabelText } = render(DragHandle, {
			props: {
				label: "Reorder Alpha",
				dragDisabled: true,
				onDragStart: () => {},
				onMoveUp,
				onMoveDown,
			},
		});
		await fireEvent.keyDown(getByLabelText("Reorder Alpha"), { key: "ArrowLeft" });
		expect(onMoveUp).not.toHaveBeenCalled();
		expect(onMoveDown).not.toHaveBeenCalled();
	});
});
