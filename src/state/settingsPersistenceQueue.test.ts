import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type QuickAddSettings } from "../settings";
import { deepClone } from "../utils/deepClone";
import { SettingsPersistenceQueue } from "./settingsPersistenceQueue";

function settingsWithRevision(revision: number): QuickAddSettings {
	const settings = deepClone(DEFAULT_SETTINGS);
	settings.version = `revision-${revision}`;
	settings.globalVariables = {
		...settings.globalVariables,
		__revision: String(revision),
	};
	return settings;
}

describe("SettingsPersistenceQueue", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("coalesces burst updates into a single write of the newest revision", async () => {
		const writes: string[] = [];
		const queue = new SettingsPersistenceQueue(
			async (settings) => {
				writes.push(settings.version);
			},
			{ debounceMs: 50, maxWaitMs: 500 },
		);

		queue.schedule(settingsWithRevision(1));
		queue.schedule(settingsWithRevision(2));
		queue.schedule(settingsWithRevision(3));

		await vi.advanceTimersByTimeAsync(49);
		expect(writes).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(1);
		await queue.flushNow();

		expect(writes).toEqual(["revision-3"]);
		expect(queue.getStats()).toMatchObject({
			scheduledRevisions: 3,
			flushedRevisions: 1,
			lastFlushedRevision: 3,
			writesStarted: 1,
			writesCompleted: 1,
		});
	});

	it("writes only the latest queued revision after an in-flight write", async () => {
		const writes: string[] = [];
		const writeResolvers: Array<() => void> = [];
		const queue = new SettingsPersistenceQueue(
			(settings) =>
				new Promise<void>((resolve) => {
					writeResolvers.push(() => {
						writes.push(settings.version);
						resolve();
					});
				}),
			{ debounceMs: 0, maxWaitMs: 0 },
		);

		queue.schedule(settingsWithRevision(1));
		await Promise.resolve();
		expect(writeResolvers).toHaveLength(1);

		queue.schedule(settingsWithRevision(2));
		queue.schedule(settingsWithRevision(3));
		await Promise.resolve();
		expect(writeResolvers).toHaveLength(1);

		writeResolvers.shift()?.();
		await Promise.resolve();
		expect(writeResolvers).toHaveLength(1);

		writeResolvers.shift()?.();
		await queue.flushNow();

		expect(writes).toEqual(["revision-1", "revision-3"]);
		expect(queue.getStats().lastFlushedRevision).toBe(3);
	});

	it("flushNow bypasses debounce waiting", async () => {
		const writes: string[] = [];
		const queue = new SettingsPersistenceQueue(
			async (settings) => {
				writes.push(settings.version);
			},
			{ debounceMs: 10_000, maxWaitMs: 10_000 },
		);

		queue.schedule(settingsWithRevision(1));
		const flushPromise = queue.flushNow();
		await Promise.resolve();
		await flushPromise;

		expect(writes).toEqual(["revision-1"]);
	});

	it("captures an immutable snapshot when scheduling", async () => {
		const writes: QuickAddSettings[] = [];
		const queue = new SettingsPersistenceQueue(
			async (settings) => {
				writes.push(settings);
			},
			{ debounceMs: 25, maxWaitMs: 100 },
		);

		const source = settingsWithRevision(1);
		queue.schedule(source);
		source.version = "revision-mutated";
		source.globalVariables.__revision = "mutated";

		await vi.advanceTimersByTimeAsync(25);
		await queue.flushNow();

		expect(writes).toHaveLength(1);
		const persisted = writes[0];
		if (!persisted) {
			throw new Error("Expected a persisted snapshot");
		}
		expect(persisted.version).toBe("revision-1");
		expect(persisted.globalVariables.__revision).toBe("1");
	});

	it("always persists the latest revision under delayed async writes", async () => {
		const delays = [35, 5, 20, 10, 15];
		let writes = 0;
		let diskRevision = "";

		const queue = new SettingsPersistenceQueue(
			async (settings) => {
				const delay = delays[writes % delays.length];
				writes += 1;
				await new Promise((resolve) => setTimeout(resolve, delay));
				diskRevision = settings.version;
			},
			{ debounceMs: 0, maxWaitMs: 0 },
		);

		for (let revision = 1; revision <= 50; revision += 1) {
			queue.schedule(settingsWithRevision(revision));
		}

		const flushPromise = queue.flushNow();
		await vi.runAllTimersAsync();
		await flushPromise;

		expect(diskRevision).toBe("revision-50");
		expect(queue.getStats().lastFlushedRevision).toBe(50);
	});
});
