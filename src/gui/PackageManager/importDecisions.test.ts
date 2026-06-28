import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
	ExistenceResolver,
	applyExistsResult,
	defaultAssetDecision,
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
		const pending: Array<(value: boolean) => void> = [];
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
				adapter: {
					exists: vi.fn(
						() => new Promise<boolean>((resolve) => pending.push(resolve)),
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
		// adapter.exists would happily stat anything (incl. out-of-vault) and the
		// index lookup would too — so the spies prove the boundary check, not luck.
		const exists = vi.fn(async () => true);
		const getAbstractFileByPath = vi.fn(() => ({}) as unknown);
		const app = {
			vault: { getAbstractFileByPath, adapter: { exists } },
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
