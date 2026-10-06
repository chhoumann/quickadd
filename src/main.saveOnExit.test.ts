import { afterEach, describe, expect, it, vi } from "vitest";
import QuickAdd from "./main";
import { DEFAULT_SETTINGS } from "./settings";

function setup() {
	const plugin = new (QuickAdd as unknown as new () => QuickAdd)();
	const internals = plugin as unknown as {
		requestSave: () => void;
		saveSettings: () => Promise<void>;
		flushPendingSave: () => Promise<void> | null;
	};
	const writes: { resolve: () => void; reject: (error: Error) => void }[] = [];
	const saveData = vi.fn(
		() => new Promise<void>((resolve, reject) => writes.push({ resolve, reject })),
	);
	Object.assign(plugin, {
		settings: structuredClone(DEFAULT_SETTINGS),
		loadData: async () => structuredClone(DEFAULT_SETTINGS),
		saveData,
	});
	return {
		internals,
		saveData,
		finishWrite: () => writes.shift()?.resolve(),
		failWrite: () => writes.shift()?.reject(new Error("disk full")),
	};
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
	// is handed something to wait for.
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

	it("waits for a change made while a write is running", async () => {
		vi.useFakeTimers();
		const { internals, saveData, finishWrite } = setup();

		internals.requestSave();
		await vi.advanceTimersByTimeAsync(1000);
		internals.requestSave();

		const write = internals.flushPendingSave();
		let landed = false;
		void write?.then(() => (landed = true));
		finishWrite();
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(2));
		expect(landed).toBe(false);
		expect(internals.flushPendingSave()).not.toBeNull();

		finishWrite();
		await write;
		expect(internals.flushPendingSave()).toBeNull();
	});

	it("leaves nothing to wait for after a write fails", async () => {
		const { internals, saveData, failWrite } = setup();

		const save = internals.saveSettings();
		const write = internals.flushPendingSave();
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
		failWrite();
		await expect(save).rejects.toThrow("disk full");
		await expect(write).rejects.toThrow("disk full");

		expect(internals.flushPendingSave()).toBeNull();
	});
});
