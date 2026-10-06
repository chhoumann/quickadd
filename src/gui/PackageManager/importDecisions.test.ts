import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import {
	ExistenceResolver,
	applyExistsResult,
	countChoiceOverwrites,
	countFileOverwrites,
	defaultAssetDecision,
	fileGroup,
	effectiveChoiceMode,
	initAssetDecisions,
	reconcileMode,
	resolveAssetDecision,
	setAssetMode,
	setAssetPath,
	snapshotAssetDecisions,
	snapshotChoiceDecisions,
	type AssetConflict,
	type AssetDecisions,
} from "./importDecisions";

const conflict = (
	originalPath: string,
	exists = false,
	kind: AssetConflict["kind"] = "user-script",
): AssetConflict => ({ originalPath, exists, kind });

const never = () => false;
const always = () => true;

describe("reconcileMode", () => {
	it("keeps skip sticky regardless of existence", () => {
		expect(reconcileMode("skip", true)).toBe("skip");
		expect(reconcileMode("skip", false)).toBe("skip");
	});

	it("keeps a file already there when asked to, and writes where there is none", () => {
		const conflict = { originalPath: "Templates/Meeting.md", exists: true } as AssetConflict;
		const kept = defaultAssetDecision(conflict, () => "Templates/Meeting.md", () => true, { keepExisting: true });
		expect(kept.mode).toBe("skip");
		const fresh = defaultAssetDecision({ ...conflict, exists: false }, () => "Templates/New.md", () => false, { keepExisting: true });
		expect(fresh.mode).toBe("write");
	});

	it("writes a relocated file whose destination is empty, even when the package's own path is taken", () => {
		const conflict = { originalPath: "Templates/Meeting.md", exists: true } as AssetConflict;
		const relocated = defaultAssetDecision(conflict, () => "My Templates/Meeting.md", () => false, { keepExisting: true });
		expect(relocated.mode).toBe("write");
	});

	it("turns a write picked for a file that is there into an overwrite", () => {
		const decisions: AssetDecisions = new Map([
			["T.md", { mode: "skip", destinationPath: "T.md", destinationExists: true }],
		]);
		expect(setAssetMode(decisions, "T.md", "write", () => true).get("T.md")?.mode).toBe("overwrite");
	});

	it("keeps a file that turns out to be there when asked to", () => {
		const decisions: AssetDecisions = new Map([
			["T.md", { mode: "write", destinationPath: "Templates/T.md", destinationExists: false }],
		]);
		expect(applyExistsResult(decisions, "T.md", true, { keepExisting: true }).get("T.md")?.mode).toBe("skip");
		expect(applyExistsResult(decisions, "T.md", true).get("T.md")?.mode).toBe("overwrite");
	});

	it("keeps a file at a destination typed in, when asked to", () => {
		const decisions: AssetDecisions = new Map([
			["T.md", { mode: "write", destinationPath: "T.md", destinationExists: false }],
		]);
		const edited = setAssetPath(decisions, "T.md", "Templates/Mine.md", (path) => path === "Templates/Mine.md", { keepExisting: true });
		expect(edited.decisions.get("T.md")?.mode).toBe("skip");
	});

	it("flips write -> overwrite when the destination exists", () => {
		expect(reconcileMode("write", true)).toBe("overwrite");
	});

	it("flips overwrite -> write when the destination no longer exists", () => {
		expect(reconcileMode("overwrite", false)).toBe("write");
	});

	it("leaves an already-consistent mode unchanged", () => {
		expect(reconcileMode("write", false)).toBe("write");
		expect(reconcileMode("overwrite", true)).toBe("overwrite");
	});
});

describe("effectiveChoiceMode", () => {
	it("downgrades overwrite to import when the choice does not exist", () => {
		expect(effectiveChoiceMode("overwrite", false)).toBe("import");
		expect(effectiveChoiceMode("overwrite", true)).toBe("overwrite");
		expect(effectiveChoiceMode("duplicate", false)).toBe("duplicate");
	});
});

describe("asset decision construction", () => {
	it("defaults to overwrite when the destination exists, write otherwise", () => {
		const id = (c: AssetConflict) => c.originalPath;
		expect(defaultAssetDecision(conflict("a.js"), id, never)).toMatchObject({
			mode: "write",
			destinationExists: false,
		});
		expect(defaultAssetDecision(conflict("a.js"), id, always)).toMatchObject({
			mode: "overwrite",
			destinationExists: true,
		});
		// conflict.exists alone (analysis-time truth) forces overwrite.
		expect(
			defaultAssetDecision(conflict("a.js", true), id, never),
		).toMatchObject({ mode: "overwrite", destinationExists: true });
	});

	it("resolveAssetDecision falls back to a default when none is stored", () => {
		const id = (c: AssetConflict) => c.originalPath;
		const decisions: AssetDecisions = new Map();
		expect(
			resolveAssetDecision(decisions, conflict("a.js"), id, never).mode,
		).toBe("write");
	});
});

describe("editing the destination", () => {
	const id = (c: AssetConflict) => c.originalPath;

	it("reconciles the mode when the typed path's existence changes", () => {
		let decisions = initAssetDecisions([conflict("a.js")], id, never);
		expect(decisions.get("a.js")?.mode).toBe("write");

		// Type a path that exists -> write flips to overwrite.
		const r1 = setAssetPath(decisions, "a.js", "exists.md", always);
		expect(r1.decisions.get("a.js")).toMatchObject({
			mode: "overwrite",
			destinationPath: "exists.md",
			destinationExists: true,
		});
		expect(r1.effectivePath).toBe("exists.md");

		// Type a path that doesn't exist -> overwrite flips back to write.
		const r2 = setAssetPath(r1.decisions, "a.js", "new.md", never);
		expect(r2.decisions.get("a.js")?.mode).toBe("write");
	});

	it("never auto-changes a skip decision while editing", () => {
		let decisions = setAssetMode(
			initAssetDecisions([conflict("a.js")], id, never),
			"a.js",
			"skip",
			never,
		);
		const r = setAssetPath(decisions, "a.js", "exists.md", always);
		expect(r.decisions.get("a.js")?.mode).toBe("skip");
	});
});

describe("applyExistsResult", () => {
	const id = (c: AssetConflict) => c.originalPath;

	it("corrects the stored mode when async existence differs", () => {
		const decisions = initAssetDecisions([conflict("a.js")], id, never);
		// Optimistic said new -> write; the authoritative check finds it exists.
		const next = applyExistsResult(decisions, "a.js", true);
		expect(next.get("a.js")).toMatchObject({
			destinationExists: true,
			mode: "overwrite",
		});
	});

	it("is a no-op (same Map) when existence is unchanged", () => {
		const decisions = initAssetDecisions([conflict("a.js")], id, never);
		expect(applyExistsResult(decisions, "a.js", false)).toBe(decisions);
	});

	it("ignores a key that is not in the decisions", () => {
		const decisions = initAssetDecisions([conflict("a.js")], id, never);
		expect(applyExistsResult(decisions, "ghost.js", true)).toBe(decisions);
	});
});

describe("snapshots for applyPackageImport", () => {
	const id = (c: AssetConflict) => c.originalPath;

	it("snapshots choice decisions with the effective mode", () => {
		const conflicts = [
			{ choiceId: "a", name: "A", parentChoiceId: null, pathHint: [], exists: false },
			{ choiceId: "b", name: "B", parentChoiceId: null, pathHint: [], exists: true },
		];
		const decisions = new Map<string, "import" | "overwrite" | "duplicate" | "skip">([
			["a", "overwrite"], // invalid (a does not exist) -> import
			["b", "overwrite"],
		]);
		expect(snapshotChoiceDecisions(conflicts, decisions)).toEqual([
			{ choiceId: "a", mode: "import" },
			{ choiceId: "b", mode: "overwrite" },
		]);
	});

	it("snapshots asset decisions with destination + mode", () => {
		const conflicts = [conflict("a.js"), conflict("b.js")];
		let decisions = initAssetDecisions(conflicts, id, never);
		decisions = setAssetPath(decisions, "a.js", "moved/a.js", never).decisions;
		const snap = snapshotAssetDecisions(conflicts, decisions, never);
		expect(snap).toEqual([
			{ originalPath: "a.js", destinationPath: "moved/a.js", mode: "write" },
			{ originalPath: "b.js", destinationPath: "b.js", mode: "write" },
		]);
	});
});

describe("ExistenceResolver — monotonic token (regression: re-paste race)", () => {
	function deferredApp() {
		const pending: Array<(exists: boolean) => void> = [];
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
				adapter: {
					stat: vi.fn(
						() =>
							new Promise((resolve) =>
								pending.push((exists) => resolve(exists ? { type: "file" } : null)),
							),
					),
				},
			},
		} as unknown as App;
		return { app, pending };
	}

	const flush = () => new Promise((r) => setTimeout(r, 0));

	it("drops a stale in-flight result when the same key is rescheduled", async () => {
		const { app, pending } = deferredApp();
		const resolver = new ExistenceResolver(app);
		const got: boolean[] = [];

		// First schedule (token 1) — simulates package A, still in flight.
		resolver.schedule("scripts/x.js", "destA", (e) => got.push(e));
		// Re-schedule same key (token 2) — simulates re-paste / edit.
		resolver.schedule("scripts/x.js", "destB", (e) => got.push(e));

		// The newer (current) call resolves first.
		pending[1](true);
		await flush();
		expect(got).toEqual([true]);

		// The stale call resolves later — its callback MUST be ignored, even
		// though the old buggy code reset tokens and would have let it through.
		pending[0](false);
		await flush();
		expect(got).toEqual([true]);
	});

	it("delivers the authoritative result for the latest schedule", async () => {
		const { app, pending } = deferredApp();
		const resolver = new ExistenceResolver(app);
		let result: boolean | undefined;
		resolver.schedule("k", "p", (e) => (result = e));
		pending[0](true);
		await flush();
		expect(result).toBe(true);
	});
});

describe("ExistenceResolver — vault-boundary containment (security)", () => {
	function spyApp() {
		// adapter.stat would happily stat anything (incl. out-of-vault) and the
		// index lookup would too — so the spies prove the boundary check, not luck.
		const exists = vi.fn(async () => ({ type: "file" }));
		const getAbstractFileByPath = vi.fn(() => ({}) as unknown);
		const app = {
			vault: { getAbstractFileByPath, adapter: { stat: exists } },
		} as unknown as App;
		return { app, exists, getAbstractFileByPath };
	}
	const flush = () => new Promise((r) => setTimeout(r, 0));

	it("never stats an out-of-vault destination and reports it not-present", async () => {
		const { app, exists } = spyApp();
		const resolver = new ExistenceResolver(app);
		const escaping = "../../../etc/passwd";
		let result: boolean | undefined;
		resolver.schedule(escaping, escaping, (e) => (result = e));
		await flush();
		expect(result).toBe(false);
		expect(exists).not.toHaveBeenCalled();
	});

	it("optimistic() reports an out-of-vault path not-present without an index lookup", () => {
		const { app, getAbstractFileByPath } = spyApp();
		const resolver = new ExistenceResolver(app);
		expect(resolver.optimistic("/etc/passwd")).toBe(false);
		expect(getAbstractFileByPath).not.toHaveBeenCalled();
	});

	it("still resolves a legitimate in-vault path via the adapter", async () => {
		const { app, exists } = spyApp();
		const resolver = new ExistenceResolver(app);
		let result: boolean | undefined;
		resolver.schedule("scripts/x.js", "scripts/x.js", (e) => (result = e));
		await flush();
		expect(exists).toHaveBeenCalledWith("scripts/x.js");
		expect(result).toBe(true);
	});
});

describe("ExistenceResolver — a folder is not an existing file (#1865)", () => {
	const flush = () => new Promise((r) => setTimeout(r, 0));
	function vaultWithFolder() {
		const folder = new TFolder();
		folder.path = "Scripts";
		const file = new TFile();
		file.path = "Scripts/brainDump.js";
		const entries = new Map<string, unknown>([["Scripts", folder], [file.path, file]]);
		return {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => entries.get(path) ?? null),
				adapter: {
					stat: vi.fn(async (path: string) =>
						path === "Scripts" ? { type: "folder" } : entries.has(path) ? { type: "file" } : null,
					),
				},
			},
		} as unknown as App;
	}

	it("reports a folder as not existing, and as a folder", async () => {
		const resolver = new ExistenceResolver(vaultWithFolder());
		expect(resolver.optimistic("Scripts")).toBe(false);
		expect(resolver.isFolder("Scripts")).toBe(true);
		expect(resolver.optimistic("Scripts/brainDump.js")).toBe(true);
		expect(resolver.isFolder("Scripts/brainDump.js")).toBe(false);

		let result: boolean | undefined;
		resolver.schedule("k", "Scripts", (exists) => (result = exists));
		await flush();
		expect(result).toBe(false);
	});
});

describe("the review's file groups", () => {
	it("lists a file by whether it was in the vault and what the reader decided", () => {
		expect(fileGroup(false, "write")).toBe("added");
		expect(fileGroup(false, "skip")).toBe("kept");
		expect(fileGroup(true, "overwrite")).toBe("overwrite");
		expect(fileGroup(true, "skip")).toBe("kept");
	});

	it("counts only the choices the import replaces", () => {
		const conflicts = [
			{ choiceId: "a", exists: true },
			{ choiceId: "b", exists: true },
			{ choiceId: "c", exists: false },
			{ choiceId: "d", exists: true },
		] as unknown as Parameters<typeof countChoiceOverwrites>[0];
		const decisions = new Map([
			["a", "overwrite"],
			["b", "skip"],
			["c", "overwrite"],
			["d", "duplicate"],
		] as const);

		expect(countChoiceOverwrites(conflicts, decisions)).toBe(1);
		expect(countChoiceOverwrites(conflicts, new Map([["a", "skip"]]))).toBe(0);
	});

	it("counts only the files the import writes over", () => {
		expect(countFileOverwrites([
			{ mode: "overwrite", destinationPath: "a.md", destinationExists: true },
			{ mode: "skip", destinationPath: "b.md", destinationExists: true },
			{ mode: "write", destinationPath: "c.md", destinationExists: false },
		])).toBe(1);
	});
});
