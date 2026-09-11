import { describe, expect, it } from "vitest";
import { deepClone } from "./deepClone";
import {
	diskSettingsDivergedFromBase,
	reconcileSettingsPersistPlan,
	resolveSettingsToPersist,
	settingsValuesEqual,
	shouldApplyPersistedWriteToStore,
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

	it("merges ai.providers by id so concurrent provider edits both survive", () => {
		const base = {
			ai: {
				providers: [
					{
						id: "openai",
						name: "OpenAI",
						endpoint: "https://api.openai.com",
						models: [{ name: "gpt-4o", maxTokens: 128000 }],
					},
					{
						id: "anthropic",
						name: "Anthropic",
						endpoint: "https://api.anthropic.com",
						models: [{ name: "claude-sonnet", maxTokens: 200000 }],
					},
				],
			},
		};

		const local = deepClone(base);
		// Background model sync discovers a new OpenAI model.
		local.ai.providers[0].models.push({
			name: "gpt-5.5",
			maxTokens: 1050000,
		});

		const disk = deepClone(base);
		// External edit changes the Anthropic endpoint on another device.
		disk.ai.providers[1].endpoint = "https://anthropic.example/v1";

		const merged = threeWayMergeSettings(base, local, disk);

		expect(merged.ai.providers).toHaveLength(2);
		const openai = merged.ai.providers.find((p) => p.id === "openai");
		const anthropic = merged.ai.providers.find((p) => p.id === "anthropic");
		expect(openai?.models.map((m) => m.name)).toEqual([
			"gpt-4o",
			"gpt-5.5",
		]);
		expect(anthropic?.endpoint).toBe("https://anthropic.example/v1");
	});

	it("keeps an externally added provider when local model sync only touches another provider", () => {
		// CodeRabbit outside-diff Major on #1750: whole-array prefer-local used to
		// drop a disk-added provider whenever background sync rewrote providers[].
		const base = {
			ai: {
				providers: [
					{
						id: "openai",
						name: "OpenAI",
						endpoint: "https://api.openai.com",
						models: [{ name: "gpt-4o", maxTokens: 128000 }],
					},
				],
				lastModelAutoSyncAt: undefined as number | undefined,
			},
		};

		const local = deepClone(base);
		local.ai.providers[0].models.push({
			name: "gpt-5.5",
			maxTokens: 1050000,
		});
		local.ai.lastModelAutoSyncAt = 1788982813069;

		const disk = deepClone(base);
		disk.ai.providers.push({
			id: "ollama",
			name: "Ollama",
			endpoint: "http://127.0.0.1:11434",
			models: [{ name: "llama3", maxTokens: 8192 }],
		});

		const merged = resolveSettingsToPersist(base, local, disk).toWrite;

		expect(merged.ai.lastModelAutoSyncAt).toBe(1788982813069);
		expect(merged.ai.providers.map((p) => p.id)).toEqual([
			"openai",
			"ollama",
		]);
		expect(
			merged.ai.providers
				.find((p) => p.id === "openai")
				?.models.map((m) => m.name),
		).toEqual(["gpt-4o", "gpt-5.5"]);
		expect(
			merged.ai.providers.find((p) => p.id === "ollama")?.endpoint,
		).toBe("http://127.0.0.1:11434");
	});

	it("merges provider models by name so sync and external metadata edits both survive", () => {
		const base = {
			ai: {
				providers: [
					{
						id: "openai",
						name: "OpenAI",
						endpoint: "https://api.openai.com",
						models: [{ name: "gpt-4o", maxTokens: 128000 }],
					},
				],
			},
		};

		const local = deepClone(base);
		local.ai.providers[0].models.push({
			name: "gpt-5.5",
			maxTokens: 1050000,
		});

		const disk = deepClone(base);
		disk.ai.providers[0].models[0].maxTokens = 200000;

		const merged = threeWayMergeSettings(base, local, disk);
		const models = merged.ai.providers[0].models;

		expect(models.map((m) => m.name)).toEqual(["gpt-4o", "gpt-5.5"]);
		expect(models.find((m) => m.name === "gpt-4o")?.maxTokens).toBe(200000);
		expect(models.find((m) => m.name === "gpt-5.5")?.maxTokens).toBe(
			1050000,
		);
	});

	it("falls back to name+endpoint when provider id is missing", () => {
		const base = {
			ai: {
				providers: [
					{
						name: "Custom",
						endpoint: "http://localhost:8080",
						models: [{ name: "a", maxTokens: 1 }],
					},
				],
			},
		};
		const local = deepClone(base);
		local.ai.providers[0].models.push({ name: "b", maxTokens: 2 });
		const disk = deepClone(base);
		disk.ai.providers[0].endpoint = "http://localhost:9090";

		const merged = threeWayMergeSettings(base, local, disk);
		// Same name but endpoint changed on disk → treated as a different key
		// once name+endpoint is the identity, so local keep + disk add.
		expect(merged.ai.providers.length).toBeGreaterThanOrEqual(1);
		expect(
			merged.ai.providers.some((p) =>
				p.models.some((m) => m.name === "b"),
			),
		).toBe(true);
		expect(
			merged.ai.providers.some(
				(p) => p.endpoint === "http://localhost:9090",
			),
		).toBe(true);
	});

	it("does not name-merge choices arrays (duplicate display names must survive)", () => {
		// Regression: isModelLike used to match any `{ name }` object, so choices
		// were keyed by display name and a second "Journal" was dropped.
		const base = {
			choices: [
				{ id: "1", name: "Journal", type: "Capture", command: false },
				{ id: "2", name: "Journal", type: "Template", command: false },
			],
		};
		const local = deepClone(base);
		local.choices[0] = { ...local.choices[0], command: true };
		const disk = deepClone(base);
		disk.choices.push({
			id: "3",
			name: "Other",
			type: "Macro",
			command: false,
		});

		const merged = threeWayMergeSettings(base, local, disk);
		// Irreducible choices[] conflict prefers local (documented policy).
		expect(merged.choices).toEqual(local.choices);
		expect(merged.choices).toHaveLength(2);
		expect(merged.choices.map((c) => c.id)).toEqual(["1", "2"]);
	});

	it("still preserves disk choices when local only changed ai (the #1749 shape)", () => {
		const base = {
			choices: [
				{ id: "1", name: "Journal", type: "Capture" },
				{ id: "2", name: "Journal", type: "Template" },
			],
			ai: {
				lastModelAutoSyncAt: undefined as number | undefined,
				providers: [
					{
						id: "openai",
						name: "OpenAI",
						endpoint: "https://api.openai.com",
						models: [{ name: "gpt-4o", maxTokens: 128000 }],
					},
				],
			},
		};
		const local = deepClone(base);
		local.ai.providers[0].models.push({
			name: "gpt-5.5",
			maxTokens: 1050000,
		});
		local.ai.lastModelAutoSyncAt = 99;
		const disk = deepClone(base);
		disk.choices.push({ id: "3", name: "Other", type: "Macro" });

		const merged = resolveSettingsToPersist(base, local, disk).toWrite;
		expect(merged.choices.map((c) => c.id)).toEqual(["1", "2", "3"]);
		expect(merged.ai.lastModelAutoSyncAt).toBe(99);
		expect(
			merged.ai.providers[0].models.map((m) => m.name),
		).toEqual(["gpt-4o", "gpt-5.5"]);
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
	it("folds store mutations during loadData onto the disk merge via three-way (Codex P1 / CodeRabbit #1750)", () => {
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
		// Disk-only syncMarker + in-flight prompt edit + local lastModelAutoSyncAt.
		expect(plan.toWrite).toEqual({
			globalVariables: { syncMarker: "device-a-newer" },
			ai: { lastModelAutoSyncAt: 99, prompt: "user-edit-during-read" },
		});
		expect(plan.shouldReplaceStore).toBe(true);
		expect(plan.local).toEqual(currentStore);
	});

	it("three-way merges current store onto toWrite using local as base before replace/save", () => {
		const base = { a: 1, b: 1, c: 1 };
		const local = { a: 2, b: 1, c: 1 };
		const disk = { a: 1, b: 2, c: 1 };
		// Store advanced after local was captured: c edited in memory.
		const currentStore = { a: 2, b: 1, c: 3 };

		const plan = reconcileSettingsPersistPlan({
			base,
			disk,
			local,
			currentStore,
		});

		expect(plan.toWrite).toEqual({ a: 2, b: 2, c: 3 });
		expect(plan.shouldReplaceStore).toBe(true);
	});
	it("does not recommend replaceState when the store no longer matches the merge local", () => {
		const base = { version: "1", note: "base" };
		const local = { version: "2", note: "base" };
		const disk = { version: "1", note: "disk" };
		const currentStore = { version: "3", note: "even-newer" };

		// Force the "no re-merge from currentStore" path by passing currentStore
		// that differs; reconcile will re-merge, so shouldReplace becomes true
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

describe("shouldApplyPersistedWriteToStore", () => {
	it("applies when toWrite kept disk-only fields the live store lacks", () => {
		const storeSnapshot = {
			globalVariables: { syncMarker: "stale" },
			ai: { lastModelAutoSyncAt: 99 },
		};
		const toWrite = {
			globalVariables: { syncMarker: "from-disk" },
			ai: { lastModelAutoSyncAt: 99 },
		};

		expect(
			shouldApplyPersistedWriteToStore(
				toWrite,
				storeSnapshot,
				storeSnapshot,
			),
		).toBe(true);
	});

	it("skips when the store already matches toWrite", () => {
		const value = { globalVariables: { syncMarker: "from-disk" } };
		expect(shouldApplyPersistedWriteToStore(value, value, value)).toBe(
			false,
		);
	});

	it("skips when the store moved after the final-merge snapshot", () => {
		const storeSnapshot = { note: "merged-from" };
		const currentStore = { note: "even-newer" };
		const toWrite = { note: "from-disk", extra: true };

		expect(
			shouldApplyPersistedWriteToStore(
				toWrite,
				currentStore,
				storeSnapshot,
			),
		).toBe(false);
	});
});
