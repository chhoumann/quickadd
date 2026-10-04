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
