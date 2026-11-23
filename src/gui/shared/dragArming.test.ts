// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDragArming } from "./dragArming.svelte";

// A jsdom iframe stands in for an Obsidian popout: its own Window and Document.
let frame: HTMLIFrameElement;
let popout: Window & typeof globalThis;

beforeEach(() => {
	frame = document.createElement("iframe");
	document.body.appendChild(frame);
	popout = frame.contentWindow as Window & typeof globalThis;
});

afterEach(() => {
	frame.remove();
});

describe("createDragArming", () => {
	it("disarms on a pointer release in the popout window that holds the handle", () => {
		const drag = createDragArming();
		const handle = popout.document.createElement("button");
		popout.document.body.appendChild(handle);
		handle.addEventListener("pointerdown", (event) => drag.startDrag(event));

		handle.dispatchEvent(new popout.Event("pointerdown", { bubbles: true }));
		expect(drag.armed).toBe(true);

		handle.dispatchEvent(new popout.Event("pointerup", { bubbles: true }));
		expect(drag.armed).toBe(false);
	});
});
