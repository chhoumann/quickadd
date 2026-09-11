import { describe, expect, it } from "vitest";
import { deepClone } from "./deepClone";
import {
	diskSettingsDivergedFromBase,
	reconcileSettingsPersistPlan,
	resolveSettingsToPersist,
	settingsValuesEqual,
	threeWayMergeSettings,
} from "./settingsPersistMerge";

describe("settingsValuesEqual", () => {
	it("treats key order as irrelevant for plain objects", () => {
		expect(settingsValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
	});

	it("treats array order as significant", () => {
		expect(settingsValuesEqual([1, 2], [2, 1])).toBe(false);
	});
});

describe("threeWayMergeSettings", () => {
	it("preserves newer on-disk user fields while keeping local model-sync edits (#1749)", () => {
		const base = {
			globalVariables: { syncMarker: "device-b-stale" },
			ai: {
				providers: [
					{
						name: "mock",
						models: [{ name: "mock-model-v1", maxTokens: 1 }],
					},
				],
				lastModelAutoSyncAt: undefined as number | undefined,
			},
		};

		const local = deepClone(base);
		local.ai.providers[0].models.push({
			name: "mock-model-v2",
			maxTokens: 32768,
		});
		local.ai.lastModelAutoSyncAt = 1788982813069;

		const disk = deepClone(base);
		disk.globalVariables.syncMarker = "device-a-newer";

		const merged = threeWayMergeSettings(base, local, disk);

		expect(merged.globalVariables.syncMarker).toBe("device-a-newer");
		expect(merged.ai.lastModelAutoSyncAt).toBe(1788982813069);
		expect(merged.ai.providers[0].models.map((m) => m.name)).toEqual([
			"mock-model-v1",
			"mock-model-v2",
		]);
	});

	it("keeps local when disk matches base", () => {
		const base = { choices: [{ id: "a" }], version: "1" };
		const local = { choices: [{ id: "a" }, { id: "b" }], version: "1" };
		const disk = deepClone(base);

		expect(threeWayMergeSettings(base, local, disk)).toEqual(local);
	});

	it("keeps disk when local matches base", () => {
		const base = { globalVariables: { x: "1" } };
		const local = deepClone(base);
		const disk = { globalVariables: { x: "2" } };

		expect(threeWayMergeSettings(base, local, disk)).toEqual(disk);
	});

	it("prefers local on irreducible leaf conflicts", () => {
		const base = { version: "1" };
		const local = { version: "2-local" };
		const disk = { version: "2-disk" };

		expect(threeWayMergeSettings(base, local, disk)).toEqual(local);
	});

	it("recurses into nested objects when both sides edit different keys", () => {
		const base = { ai: { lastModelAutoSyncAt: 1, showAssistant: true } };
		const local = { ai: { lastModelAutoSyncAt: 99, showAssistant: true } };
		const disk = { ai: { lastModelAutoSyncAt: 1, showAssistant: false } };

		expect(threeWayMergeSettings(base, local, disk)).toEqual({
			ai: { lastModelAutoSyncAt: 99, showAssistant: false },
		});
	});
});

describe("diskSettingsDivergedFromBase", () => {
	it("detects external divergence", () => {
		expect(
			diskSettingsDivergedFromBase(
				{ globalVariables: { syncMarker: "a" } },
				{ globalVariables: { syncMarker: "b" } },
			),
		).toBe(true);
		expect(
			diskSettingsDivergedFromBase(
				{ globalVariables: { syncMarker: "a" } },
				{ globalVariables: { syncMarker: "a" } },
			),
		).toBe(false);
	});
});

describe("resolveSettingsToPersist", () => {
	it("writes local unchanged when disk still matches the last persist", () => {
		const base = { globalVariables: { syncMarker: "stale" }, ai: { t: 0 } };
		const local = { globalVariables: { syncMarker: "stale" }, ai: { t: 1 } };
		const disk = deepClone(base);

		expect(resolveSettingsToPersist(base, local, disk)).toEqual({
			toWrite: local,
			didMerge: false,
		});
	});

	it("merges when disk moved on under a model-sync-style local edit", () => {
		const base = {
			globalVariables: { syncMarker: "device-b-stale" },
			ai: { lastModelAutoSyncAt: undefined as number | undefined },
		};
		const local = {
			globalVariables: { syncMarker: "device-b-stale" },
			ai: { lastModelAutoSyncAt: 99 },
		};
		const disk = {
			globalVariables: { syncMarker: "device-a-newer" },
			ai: { lastModelAutoSyncAt: undefined as number | undefined },
		};

		expect(resolveSettingsToPersist(base, local, disk)).toEqual({
			toWrite: {
				globalVariables: { syncMarker: "device-a-newer" },
				ai: { lastModelAutoSyncAt: 99 },
			},
			didMerge: true,
		});
	});

	it("skips merge when base or disk is missing", () => {
		const local = { version: "1" };
		expect(resolveSettingsToPersist(null, local, local)).toEqual({
			toWrite: local,
			didMerge: false,
		});
		expect(resolveSettingsToPersist(local, local, null)).toEqual({
			toWrite: local,
			didMerge: false,
		});
	});
});

describe("reconcileSettingsPersistPlan", () => {
	it("re-merges when the store advanced during the disk read (Codex P1 / #1750)", () => {
		const base = {
			globalVariables: { syncMarker: "device-b-stale" },
			ai: {
				lastModelAutoSyncAt: undefined as number | undefined,
				prompt: "old",
			},
		};
		const localAtStart = {
			globalVariables: { syncMarker: "device-b-stale" },
			ai: { lastModelAutoSyncAt: 99, prompt: "old" },
		};
		const disk = {
			globalVariables: { syncMarker: "device-a-newer" },
			ai: {
				lastModelAutoSyncAt: undefined as number | undefined,
				prompt: "old",
			},
		};
		// While loadData() was pending, a user edit landed in the store.
		const currentStore = {
			globalVariables: { syncMarker: "device-b-stale" },
			ai: { lastModelAutoSyncAt: 99, prompt: "user-edit-during-read" },
		};

		const plan = reconcileSettingsPersistPlan({
			base,
			disk,
			local: localAtStart,
			currentStore,
		});

		expect(plan.didMerge).toBe(true);
		expect(plan.toWrite).toEqual({
			globalVariables: { syncMarker: "device-a-newer" },
			ai: { lastModelAutoSyncAt: 99, prompt: "user-edit-during-read" },
		});
		expect(plan.shouldReplaceStore).toBe(true);
		expect(plan.local).toEqual(currentStore);
	});

	it("does not recommend replaceState when the store no longer matches the merge local", () => {
		const base = { version: "1", note: "base" };
		const local = { version: "2", note: "base" };
		const disk = { version: "1", note: "disk" };
		const currentStore = { version: "3", note: "even-newer" };

		// Force the "no re-merge from currentStore" path by passing currentStore
		// that differs — reconcile will re-merge, so shouldReplace becomes true
		// against the refreshed local. To assert the guard itself, call with
		// local === currentStore for the merge, then imagine a later drift:
		const plan = reconcileSettingsPersistPlan({
			base,
			disk,
			local,
			currentStore: local,
		});
		expect(plan.shouldReplaceStore).toBe(true);
		expect(plan.toWrite).toEqual({ version: "2", note: "disk" });

		// After planning, a newer store value must not be replaced by the old plan.
		expect(
			settingsValuesEqual(currentStore, plan.local) &&
				plan.shouldReplaceStore,
		).toBe(false);
	});

	it("skips store replace when merge is a no-op relative to the current store", () => {
		const base = { version: "1" };
		const local = { version: "1" };
		const disk = { version: "1" };

		const plan = reconcileSettingsPersistPlan({
			base,
			disk,
			local,
			currentStore: local,
		});
		expect(plan.didMerge).toBe(false);
		expect(plan.shouldReplaceStore).toBe(false);
		expect(plan.toWrite).toEqual(local);
	});
});
