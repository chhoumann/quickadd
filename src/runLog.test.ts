import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunLog, type RunLogEntry } from "./runLog";

const PATH = ".obsidian/plugins/quickadd/run-log.json";

function fakeAdapter() {
	const files = new Map<string, string>();
	return {
		files,
		exists: vi.fn(async (path: string) => files.has(path)),
		read: vi.fn(async (path: string) => files.get(path) ?? ""),
		write: vi.fn(async (path: string, data: string) => { files.set(path, data); }),
	};
}

function entry(n: number): RunLogEntry {
	return { at: `2026-10-04T10:${String(n).padStart(2, "0")}:00.000Z`, choiceId: `id-${n}`, choiceName: `Run ${n}`, status: "success", durationMs: n };
}

describe("RunLog", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("keeps the last 50 runs, newest first", async () => {
		const log = new RunLog();
		await log.load(fakeAdapter(), PATH);
		for (let n = 1; n <= 55; n++) log.append(entry(n));
		const names = log.list().map((run) => run.choiceName);
		expect(names).toHaveLength(50);
		expect(names[0]).toBe("Run 55");
		expect(names.at(-1)).toBe("Run 6");
	});

	it("survives a reload", async () => {
		const adapter = fakeAdapter();
		const log = new RunLog();
		await log.load(adapter, PATH);
		log.append(entry(1));
		log.append(entry(2));
		await vi.advanceTimersByTimeAsync(1000);

		const reloaded = new RunLog();
		await reloaded.load(adapter, PATH);
		expect(reloaded.list()).toEqual([entry(2), entry(1)]);
	});

	it("never lets a slow earlier write land over a newer one", async () => {
		const adapter = fakeAdapter();
		const written: string[] = [];
		let releaseFirst!: () => void;
		let calls = 0;
		adapter.write = vi.fn(async (_path: string, text: string) => {
			calls += 1;
			if (calls === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
			written.push(text);
		});
		const log = new RunLog();
		await log.load(adapter, PATH);
		log.append(entry(1));
		// The first write starts now and hangs; the second is scheduled behind it.
		const first = log.flush();
		await Promise.resolve();
		await Promise.resolve();
		log.append(entry(2));
		vi.advanceTimersByTime(1100);
		releaseFirst();
		await first;
		await log.flush();
		expect(written).toHaveLength(2);
		// The file ends with the newer state: both runs, not the slow write's one.
		expect(JSON.parse(written[1]!).map((e: RunLogEntry) => e.choiceName)).toEqual(
			expect.arrayContaining([entry(1).choiceName, entry(2).choiceName]),
		);
		expect(JSON.parse(written[1]!)).toHaveLength(2);
	});

	it("writes at most once a second", async () => {
		const adapter = fakeAdapter();
		const log = new RunLog();
		await log.load(adapter, PATH);
		log.append(entry(1));
		log.append(entry(2));
		expect(adapter.write).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		expect(adapter.write).toHaveBeenCalledTimes(1);
		log.append(entry(3));
		await log.flush();
		expect(adapter.write).toHaveBeenCalledTimes(2);
		expect(JSON.parse(adapter.files.get(PATH) ?? "[]")).toHaveLength(3);
	});

	it("clears the list and the file", async () => {
		const adapter = fakeAdapter();
		const log = new RunLog();
		await log.load(adapter, PATH);
		log.append(entry(1));
		const seen = vi.fn();
		log.subscribe(seen);
		log.clear();
		await log.flush();
		expect(log.list()).toEqual([]);
		expect(seen).toHaveBeenCalled();
		expect(JSON.parse(adapter.files.get(PATH) ?? "null")).toEqual([]);
	});
});
