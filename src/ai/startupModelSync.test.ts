// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleStartupModelSync } from "./startupModelSync";

/** A fake plugin: layout-ready is fired by the test; unload runs registered cleanups. */
function fakeHost() {
	const cleanups: Array<() => void> = [];
	const layoutReady: Array<() => void> = [];
	return {
		app: {
			workspace: {
				onLayoutReady: (cb: () => void) => void layoutReady.push(cb),
			},
		} as any,
		register: (cb: () => void) => void cleanups.push(cb),
		fireLayoutReady: () => layoutReady.splice(0).forEach((cb) => cb()),
		unload: () => cleanups.splice(0).forEach((cb) => cb()),
	};
}

describe("scheduleStartupModelSync", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("syncs once, 5 s after layout-ready, while the plugin stays loaded", () => {
		const host = fakeHost();
		const sync = vi.fn();
		scheduleStartupModelSync(host, sync);

		vi.advanceTimersByTime(10_000);
		expect(sync).not.toHaveBeenCalled(); // layout not ready yet

		host.fireLayoutReady();
		vi.advanceTimersByTime(4_999);
		expect(sync).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(sync).toHaveBeenCalledTimes(1);
	});

	it("does not sync when the plugin unloads during the delay", () => {
		const host = fakeHost();
		const sync = vi.fn();
		scheduleStartupModelSync(host, sync);

		host.fireLayoutReady();
		vi.advanceTimersByTime(1_000);
		host.unload();
		vi.advanceTimersByTime(60_000);

		expect(sync).not.toHaveBeenCalled();
	});

	it("does not schedule a sync when the plugin unloads before layout-ready", () => {
		const host = fakeHost();
		const sync = vi.fn();
		scheduleStartupModelSync(host, sync);

		host.unload();
		host.fireLayoutReady();
		vi.advanceTimersByTime(60_000);

		expect(sync).not.toHaveBeenCalled();
	});

	it("leaves only the live instance's sync after a reload", () => {
		const oldInstance = fakeHost();
		const newInstance = fakeHost();
		const oldSync = vi.fn();
		const newSync = vi.fn();

		scheduleStartupModelSync(oldInstance, oldSync);
		oldInstance.fireLayoutReady();
		vi.advanceTimersByTime(1_000);
		oldInstance.unload();
		scheduleStartupModelSync(newInstance, newSync);
		newInstance.fireLayoutReady();
		vi.advanceTimersByTime(60_000);

		expect(oldSync).not.toHaveBeenCalled();
		expect(newSync).toHaveBeenCalledTimes(1);
	});
});
