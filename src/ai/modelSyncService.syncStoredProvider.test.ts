import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, Model } from "./Provider";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";

const discovery = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock("./modelDiscoveryService", () => ({ discoverProviderModels: discovery.discover }));
vi.mock("./providerSecrets", () => ({ resolveProviderApiKey: vi.fn(async () => "key") }));

import { syncStoredProvider } from "./modelSyncService";

function provider(id: string, models: Model[]): AIProvider {
	return { id, name: id, endpoint: `https://${id}.example`, apiKey: "", modelSource: "providerApi", models };
}

function install(...providers: AIProvider[]): void {
	settingsStore.setState((state) => ({ ai: { ...state.ai, providers } }));
}

describe("syncStoredProvider", () => {
	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
		discovery.discover.mockReset();
	});

	it("merges into the provider as it exists when discovery returns", async () => {
		let resolve!: (models: Model[]) => void;
		discovery.discover.mockReturnValue(new Promise<Model[]>((done) => { resolve = done; }));
		install(provider("target", [
			{ name: "rename-me", maxTokens: 1 },
			{ name: "delete-me", maxTokens: 2 },
		]));
		const pending = syncStoredProvider(undefined, "target");
		settingsStore.setState((state) => ({ ai: { ...state.ai, providers: [
			{ ...state.ai.providers[0], name: "User rename", models: [{ name: "renamed", maxTokens: 9 }] },
		] } }));
		resolve([{ name: "discovered", maxTokens: 100 }]);
		await pending;

		const current = settingsStore.getState().ai.providers[0];
		expect(current.name).toBe("User rename");
		expect(current.models.map((m) => m.name)).toEqual(["renamed", "discovered"]);
		expect(current.lastModelSync).toEqual({ at: expect.any(Number) });
	});

	it("records failure, rethrows it, and leaves models alone", async () => {
		const error = new Error("offline");
		discovery.discover.mockRejectedValue(error);
		install(provider("target", [{ name: "kept", maxTokens: 7 }]));

		await expect(syncStoredProvider(undefined, "target")).rejects.toBe(error);
		const current = settingsStore.getState().ai.providers[0];
		expect(current.models).toEqual([{ name: "kept", maxTokens: 7 }]);
		expect(current.lastModelSync).toEqual({ at: expect.any(Number), error: "offline" });
	});

	it("returns null when the provider is removed while discovery is pending", async () => {
		let resolve!: (models: Model[]) => void;
		discovery.discover.mockReturnValue(new Promise<Model[]>((done) => { resolve = done; }));
		install(provider("target", []));
		const pending = syncStoredProvider(undefined, "target");
		install();
		resolve([{ name: "late", maxTokens: 1 }]);

		await expect(pending).resolves.toBeNull();
		expect(settingsStore.getState().ai.providers).toEqual([]);
	});

	it("never mutates another provider", async () => {
		const other = provider("other", [{ name: "other-model", maxTokens: 42 }]);
		install(provider("target", []), other);
		discovery.discover.mockResolvedValue([{ name: "new", maxTokens: 10 }]);

		await syncStoredProvider(undefined, "target");
		expect(settingsStore.getState().ai.providers[1]).toBe(other);
		expect(settingsStore.getState().ai.providers[1].lastModelSync).toBeUndefined();
	});
});
