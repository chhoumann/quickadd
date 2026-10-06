import { afterEach, describe, expect, it, vi } from "vitest";
import QuickAdd from "./main";
import { DEFAULT_SETTINGS } from "./settings";

function setup() {
	const plugin = new (QuickAdd as unknown as new () => QuickAdd)();
	const internals = plugin as unknown as {
		requestSave: () => void;
		flushPendingSave: () => Promise<void> | null;
	};
	const finishWrites: (() => void)[] = [];
	const saveData = vi.fn(
		() => new Promise<void>((resolve) => finishWrites.push(resolve)),
	);
	Object.assign(plugin, { settings: structuredClone(DEFAULT_SETTINGS), saveData });
	return { internals, saveData, finishWrite: () => finishWrites.shift()?.() };
}

describe("QuickAdd's pending settings write", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("is written when flushed, as on quit, and not before", async () => {
		const { internals, saveData, finishWrite } = setup();

		// A settings change schedules the debounced write.
		internals.requestSave();
		expect(saveData).not.toHaveBeenCalled();

		const write = internals.flushPendingSave();
		expect(write).not.toBeNull();
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
		finishWrite();
		await write;
	});

	// Obsidian cancels the window close and shows "Saving..." whenever quit
	// is handed something to wait for (#2194).
	it("leaves nothing to wait for when no write is pending or running", async () => {
		const { internals, saveData } = setup();

		expect(internals.flushPendingSave()).toBeNull();
		expect(saveData).not.toHaveBeenCalled();
	});

	it("returns a write the debounce already started until it lands", async () => {
		vi.useFakeTimers();
		const { internals, saveData, finishWrite } = setup();

		internals.requestSave();
		await vi.advanceTimersByTimeAsync(1000);
		expect(saveData).toHaveBeenCalledTimes(1);

		const write = internals.flushPendingSave();
		expect(write).not.toBeNull();
		let landed = false;
		void write?.then(() => (landed = true));
		await vi.advanceTimersByTimeAsync(0);
		expect(landed).toBe(false);

		finishWrite();
		await write;
		expect(internals.flushPendingSave()).toBeNull();
		expect(saveData).toHaveBeenCalledTimes(1);
	});
});
