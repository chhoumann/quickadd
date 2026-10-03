import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { createNoteAfterTemplaterTrigger } from "./templaterIntegration";

vi.mock("../logger/logManager", () => ({ log: { logWarning: vi.fn(), logMessage: vi.fn(), logError: vi.fn() } }));

type Handler = (templater: unknown, app: unknown, file: { path: string }) => Promise<void>;

/** A stand-in for Templater 2.x: a class whose static handler the create event calls through the class. */
function fakeTemplater(onCreate: Handler) {
	class Templater {
		static on_file_creation: Handler = onCreate;
		files_with_pending_templates = new Set<string>();
	}
	const templater = new Templater();
	const listeners: ((file: { path: string }) => unknown)[] = [
		(file) => Templater.on_file_creation(templater, {}, file),
	];
	const app = {
		plugins: { plugins: { "templater-obsidian": { settings: { trigger_on_file_creation: true }, templater } } },
		loadLocalStorage: () => null,
		vault: { adapter: {} },
	} as unknown as App;
	// Obsidian emits "create" before vault.create resolves.
	const create = (path: string) => async () => {
		const file = { path, extension: "md" } as TFile;
		for (const listener of listeners) void listener(file);
		return file;
	};
	return { Templater, templater, app, create, emit: (path: string) => listeners[0]({ path }) };
}

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => { resolve = r; });
	return { promise, resolve };
};

afterEach(() => { vi.useRealTimers(); });

describe("createNoteAfterTemplaterTrigger", () => {
	it("waits for Templater's handling of the new note, then restores the handler", async () => {
		const done = deferred();
		const t = fakeTemplater(() => done.promise);
		const original = t.Templater.on_file_creation;
		let finished = false;
		const result = createNoteAfterTemplaterTrigger(t.app, "Inbox/a.md", t.create("Inbox/a.md"))
			.then((file) => { finished = true; return file; });

		await Promise.resolve(); await Promise.resolve();
		expect(finished).toBe(false);
		done.resolve();
		expect((await result).path).toBe("Inbox/a.md");
		expect(t.Templater.on_file_creation).toBe(original);
	});

	it("matches the note by its normalized path, as vault.create stores it", async () => {
		const done = deferred();
		const t = fakeTemplater(() => done.promise);
		vi.useFakeTimers();
		let finished = false;
		// A Canvas file card can name its note with a doubled slash.
		const result = createNoteAfterTemplaterTrigger(t.app, "Inbox//a.md", t.create("Inbox/a.md"))
			.then((file) => { finished = true; return file; });

		await vi.advanceTimersByTimeAsync(0);
		expect(finished).toBe(false);
		done.resolve();
		await vi.advanceTimersByTimeAsync(0);
		expect(finished).toBe(true);
		expect((await result).path).toBe("Inbox/a.md");
	});

	it("returns as soon as Templater decides to leave the note alone", async () => {
		const t = fakeTemplater(async () => {});
		vi.useFakeTimers();
		const file = await createNoteAfterTemplaterTrigger(t.app, "a.md", t.create("a.md"));
		expect(file.path).toBe("a.md");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("passes other notes through with their own result and does not wait for them", async () => {
		const other = deferred();
		const t = fakeTemplater((_t, _a, file) => (file.path === "other.md" ? other.promise : Promise.resolve()));
		let otherResult: unknown;
		const file = await createNoteAfterTemplaterTrigger(t.app, "mine.md", async () => {
			otherResult = t.emit("other.md");
			return t.create("mine.md")();
		});
		expect(file.path).toBe("mine.md");
		expect(otherResult).toBe(other.promise);
	});

	it("restores the handler when the create throws", async () => {
		const t = fakeTemplater(async () => {});
		const original = t.Templater.on_file_creation;
		await expect(createNoteAfterTemplaterTrigger(t.app, "a.md", async () => { throw new Error("disk full"); }))
			.rejects.toThrow("disk full");
		expect(t.Templater.on_file_creation).toBe(original);
	});

	it.each([
		["Templater has no static handler", (t: ReturnType<typeof fakeTemplater>) => {
			(t.Templater as { on_file_creation?: unknown }).on_file_creation = undefined;
		}],
		["the handler never runs for the note", () => {}],
	])("falls back to watching the pending set when %s", async (_case, change) => {
		const t = fakeTemplater(async () => {});
		change(t);
		vi.useFakeTimers();
		let finished = false;
		const run = createNoteAfterTemplaterTrigger(t.app, "a.md", async () => ({ path: "a.md", extension: "md" }) as TFile)
			.then(() => { finished = true; });
		await vi.advanceTimersByTimeAsync(2000);
		expect(finished).toBe(false);
		await vi.advanceTimersByTimeAsync(4000);
		await run;
		expect(finished).toBe(true);
	});

	it("does not touch Templater when its new-file trigger is off", async () => {
		const t = fakeTemplater(async () => {});
		(t.app.plugins.plugins["templater-obsidian"] as { settings: object }).settings = { trigger_on_file_creation: false };
		const original = t.Templater.on_file_creation;
		const spy = vi.fn(t.create("a.md"));
		await createNoteAfterTemplaterTrigger(t.app, "a.md", spy);
		expect(spy).toHaveBeenCalledOnce();
		expect(t.Templater.on_file_creation).toBe(original);
	});
});
