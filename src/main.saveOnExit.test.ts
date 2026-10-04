import { describe, expect, it, vi } from "vitest";
import QuickAdd from "./main";

describe("QuickAdd's pending settings write", () => {
	it("is written when flushed, as on quit, and not before", async () => {
		const plugin = new (QuickAdd as unknown as new () => QuickAdd)();
		const internals = plugin as unknown as {
			requestSave: () => void;
			persistSettings: () => Promise<void>;
			flushPendingSave: () => Promise<void>;
		};
		const persist = vi.spyOn(internals, "persistSettings").mockResolvedValue();

		// A settings change schedules the debounced write.
		internals.requestSave();
		expect(persist).not.toHaveBeenCalled();

		await internals.flushPendingSave();
		expect(persist).toHaveBeenCalledTimes(1);

		// Nothing pending: flushing writes nothing.
		await internals.flushPendingSave();
		expect(persist).toHaveBeenCalledTimes(1);
	});
});
