/**
 * Regression coverage for patches/svelte-dnd-action@0.9.79.patch (issue #1730).
 *
 * Obsidian 1.13 can show Settings in a popout window while the main window is
 * hidden. The drop zone then lives in a second document, but svelte-dnd-action
 * keeps using the module-global `window`/`document` (the main window):
 *  - the rAF that re-arms observation after Svelte removes the dragged item is
 *    scheduled on the hidden main window, whose frames never fire, so the list
 *    never reorders;
 *  - the off-document check measures the clone against the main document, so a
 *    drag positioned below the main window's height is finalized immediately.
 *
 * A jsdom iframe stands in for the popout: separate Window, separate Document,
 * own requestAnimationFrame. The main window's rAF is stubbed to never fire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAGGED_ELEMENT_ID, TRIGGERS, dndzone } from "svelte-dnd-action";

const ITEM_HEIGHT = 30;
const ZONE_WIDTH = 200;
const MAIN_DOCUMENT_HEIGHT = 800;
const POPOUT_DOCUMENT_HEIGHT = 2000;
const CURSOR = { x: 20, y: 45 };

let frame: HTMLIFrameElement;
let popoutWindow: Window & typeof globalThis;
let popoutFrames: FrameRequestCallback[];
let mainFrames: FrameRequestCallback[];
let zone: HTMLElement;
let action: { destroy?: () => void };
let considerTriggers: string[];
let finalizeTriggers: string[];
let cloneTop = 0;

function stackedRect(top: number, height: number, width = ZONE_WIDTH): DOMRect {
	return {
		top,
		left: 0,
		width,
		height,
		right: width,
		bottom: top + height,
		x: 0,
		y: top,
		toJSON: () => ({}),
	};
}

function rectOf(el: Element): DOMRect {
	if (el.id === DRAGGED_ELEMENT_ID) return stackedRect(cloneTop, ITEM_HEIGHT);
	if (el === zone) return stackedRect(0, ITEM_HEIGHT * 3);
	const slot = el.getAttribute("data-slot");
	if (slot === null) return stackedRect(0, 0, 0);
	return stackedRect(Number(slot) * ITEM_HEIGHT, ITEM_HEIGHT);
}

function setScrollHeight(doc: Document, value: number): void {
	Object.defineProperty(doc.documentElement, "scrollHeight", {
		value,
		configurable: true,
	});
}

function mouseMoveOnMainWindow(x: number, y: number): void {
	window.dispatchEvent(
		new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }),
	);
}

function startDragOnFirstItem(): void {
	zone.children[0].dispatchEvent(
		new popoutWindow.MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			button: 0,
			clientX: CURSOR.x,
			clientY: ITEM_HEIGHT / 2,
		}),
	);
	mouseMoveOnMainWindow(CURSOR.x, CURSOR.y);
}

function svelteRemovesDraggedItem(): void {
	zone.children[0].remove();
}

function flushFrames(frames: FrameRequestCallback[]): void {
	for (const cb of frames.splice(0)) cb(0);
}

beforeEach(() => {
	frame = document.createElement("iframe");
	document.body.appendChild(frame);
	popoutWindow = frame.contentWindow as Window & typeof globalThis;
	const popoutDocument = popoutWindow.document;

	popoutFrames = [];
	mainFrames = [];
	popoutWindow.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) =>
		popoutFrames.push(cb),
	);
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) =>
		mainFrames.push(cb),
	);

	popoutWindow.Element.prototype.getBoundingClientRect = function (
		this: Element,
	) {
		return rectOf(this);
	};
	setScrollHeight(document, MAIN_DOCUMENT_HEIGHT);
	setScrollHeight(popoutDocument, POPOUT_DOCUMENT_HEIGHT);
	// jsdom has no document.scrollingElement; the library reads it while
	// building its auto-scroller.
	Object.defineProperty(document, "scrollingElement", {
		value: document.documentElement,
		configurable: true,
	});

	zone = popoutDocument.createElement("div");
	for (const [slot, id] of ["a", "b", "c"].entries()) {
		const item = popoutDocument.createElement("div");
		item.setAttribute("data-slot", String(slot));
		item.textContent = id;
		zone.appendChild(item);
	}
	popoutDocument.body.appendChild(zone);

	considerTriggers = [];
	finalizeTriggers = [];
	zone.addEventListener("consider", (e) =>
		considerTriggers.push((e as CustomEvent).detail.info.trigger),
	);
	zone.addEventListener("finalize", (e) =>
		finalizeTriggers.push((e as CustomEvent).detail.info.trigger),
	);
	cloneTop = 0;
	action = dndzone(zone, {
		items: [{ id: "a" }, { id: "b" }, { id: "c" }],
		flipDurationMs: 0,
		dropAnimationDisabled: true,
		useCursorForDetection: true,
	});
});

afterEach(() => {
	window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
	action.destroy?.();
	frame.remove();
	vi.restoreAllMocks();
	delete (document as { scrollingElement?: Element }).scrollingElement;
	delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
});

describe("svelte-dnd-action with the drop zone in a popout window", () => {
	it("re-arms observation through the popout window's animation frames", () => {
		startDragOnFirstItem();

		expect(considerTriggers).toEqual([TRIGGERS.DRAG_STARTED]);
		expect(popoutFrames).toHaveLength(1);
		expect(mainFrames).toHaveLength(0);

		const original = zone.children[0];
		svelteRemovesDraggedItem();
		flushFrames(popoutFrames);

		expect(original.parentElement).toBe(popoutWindow.document.body);
		expect(original.hasAttribute("data-is-dnd-original-dragged-item")).toBe(
			true,
		);
		expect(considerTriggers).toEqual([
			TRIGGERS.DRAG_STARTED,
			TRIGGERS.DRAGGED_ENTERED,
		]);
	});

	it("measures off-document against the popout document, not the main one", () => {
		cloneTop = MAIN_DOCUMENT_HEIGHT + 100;
		startDragOnFirstItem();
		svelteRemovesDraggedItem();
		// Flush both windows so this test isolates the off-document check from
		// the rAF-window bug covered above.
		flushFrames(popoutFrames);
		flushFrames(mainFrames);

		expect(finalizeTriggers).toEqual([]);
		expect(
			popoutWindow.document.getElementById(DRAGGED_ELEMENT_ID),
		).not.toBeNull();
		expect(considerTriggers).toContain(TRIGGERS.DRAGGED_ENTERED);
	});
});
