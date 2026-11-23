import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import migrate from "./migrate";
import useQuickAddTemplateFolder from "./useQuickAddTemplateFolder";
import incrementFileNameSettingMoveToDefaultBehavior from "./incrementFileNameSettingMoveToDefaultBehavior";


function allOtherMigrationsComplete(
	...pending: (keyof typeof DEFAULT_SETTINGS.migrations)[]
) {
	const flags = Object.fromEntries(
		Object.keys(DEFAULT_SETTINGS.migrations).map((key) => [key, true]),
	) as typeof DEFAULT_SETTINGS.migrations;
	for (const key of pending) flags[key] = false;
	return flags;
}


// Mock the logger to avoid test output noise
vi.mock("src/logger/logManager", () => ({
	log: {
		logMessage: vi.fn(),
		logError: vi.fn(),
		logWarning: vi.fn(),
	},
}));

describe("Migration Re-entrance Safety", () => {
	let mockPlugin: any;
	let mockSettings: any;
	let unsubscribe: (() => void) | undefined;

	beforeEach(() => {
		settingsStore.replaceState(structuredClone(DEFAULT_SETTINGS));
		unsubscribe?.();
		unsubscribe = undefined;

		// Reset settings with minimal structure needed for migration tests
		mockSettings = {
			choices: [],
			migrations: {}
		};
		
		mockPlugin = {
			settings: mockSettings,
			saveSettings: vi.fn(),
		};
	});

	afterEach(() => {
		unsubscribe?.();
		unsubscribe = undefined;
		settingsStore.replaceState(structuredClone(DEFAULT_SETTINGS));
	});

	describe("Migration safety patterns", () => {
		beforeEach(() => {
			mockPlugin.settings = structuredClone(DEFAULT_SETTINGS);
			mockPlugin.settings.migrations = allOtherMigrationsComplete("useQuickAddTemplateFolder");
		});

		afterEach(() => vi.restoreAllMocks());

		it("should verify migrations are tracked correctly", async () => {
			const run = vi.spyOn(useQuickAddTemplateFolder, "migrate").mockResolvedValue();
			expect(mockPlugin.settings.migrations.useQuickAddTemplateFolder).toBe(false);
			await migrate(mockPlugin);
			expect(mockPlugin.settings.migrations.useQuickAddTemplateFolder).toBe(true);
			expect(run).toHaveBeenCalledWith(mockPlugin);
			expect(mockPlugin.saveSettings).toHaveBeenCalledOnce();
		});

		it("should not run completed migrations", async () => {
			const run = vi.spyOn(useQuickAddTemplateFolder, "migrate");
			mockPlugin.settings.migrations.useQuickAddTemplateFolder = true;
			await migrate(mockPlugin);
			expect(run).not.toHaveBeenCalled();
			expect(mockPlugin.saveSettings).not.toHaveBeenCalled();
		});

		it("should handle migration errors safely with backup", async () => {
			const originalSettings = structuredClone(mockPlugin.settings);
			vi.spyOn(useQuickAddTemplateFolder, "migrate").mockImplementation(async (plugin) => {
				plugin.settings.templateFolderPaths.push("partial mutation");
				throw new Error("Migration failed");
			});
			await migrate(mockPlugin);
			expect(mockPlugin.settings).toEqual(originalSettings);
			expect(settingsStore.getState()).toEqual(originalSettings);
			expect(mockPlugin.settings.migrations.useQuickAddTemplateFolder).toBe(false);
		});

		it("should demonstrate safe migration sequence pattern", async () => {
			mockPlugin.settings.migrations.incrementFileNameSettingMoveToDefaultBehavior = false;
			vi.spyOn(useQuickAddTemplateFolder, "migrate").mockImplementation(async (plugin) => {
				plugin.settings.templateFolderPaths.push("first");
			});
			vi.spyOn(incrementFileNameSettingMoveToDefaultBehavior, "migrate").mockImplementation(async (plugin) => {
				expect(plugin.settings.templateFolderPaths).toEqual(["first"]);
				plugin.settings.templateFolderPaths.push("second");
			});
			await migrate(mockPlugin);
			expect(mockPlugin.settings.templateFolderPaths).toEqual(["first", "second"]);
			expect(mockPlugin.settings.migrations.useQuickAddTemplateFolder).toBe(true);
			expect(mockPlugin.settings.migrations.incrementFileNameSettingMoveToDefaultBehavior).toBe(true);
		});

		it("should demonstrate idempotent migration pattern", async () => {
			const run = vi.spyOn(useQuickAddTemplateFolder, "migrate").mockImplementation(async (plugin) => {
				plugin.settings.templateFolderPaths.push("migrated");
			});
			await migrate(mockPlugin);
			const afterFirstRun = structuredClone(mockPlugin.settings);
			await migrate(mockPlugin);
			expect(mockPlugin.settings).toEqual(afterFirstRun);
			expect(mockPlugin.settings.templateFolderPaths).toEqual(["migrated"]);
			expect(run).toHaveBeenCalledOnce();
		});
	});

	describe("Specific migration interaction patterns", () => {
		it("does not let a later store-backed migration restore stale choices", async () => {
			const legacyTemplateChoice = {
				id: "daily-note",
				name: "Open Daily Note",
				type: "Template",
				setFileExistsBehavior: true,
				fileExistsMode: "Nothing",
			};
			const loadedSettings = {
				...structuredClone(DEFAULT_SETTINGS),
				choices: [legacyTemplateChoice],
				ai: {
					...structuredClone(DEFAULT_SETTINGS.ai),
					providers: [
						{
							name: "Provider without model source",
							type: "openai",
							apiKey: "",
							defaultModel: "",
							models: [],
						},
					],
				},
				migrations: allOtherMigrationsComplete(
					"consolidateFileExistsBehavior",
					"setProviderModelDiscoveryMode",
				),
			};

			settingsStore.replaceState(loadedSettings as any);
			mockPlugin = {
				manifest: { version: "2.12.2" },
				settings: structuredClone(loadedSettings),
				saveSettings: vi.fn(),
			};
			unsubscribe = settingsStore.subscribe((settings) => {
				mockPlugin.settings = settings;
				void mockPlugin.saveSettings();
			});

			await migrate(mockPlugin);

			expect(mockPlugin.settings.choices[0]).toMatchObject({
				fileExistsBehavior: { kind: "apply", mode: "doNothing" },
			});
			expect(mockPlugin.settings.choices[0]).not.toHaveProperty(
				"setFileExistsBehavior",
			);
			expect(mockPlugin.settings.choices[0]).not.toHaveProperty(
				"fileExistsMode",
			);
			expect(
				mockPlugin.settings.migrations.consolidateFileExistsBehavior,
			).toBe(true);
			expect(
				mockPlugin.settings.migrations.setProviderModelDiscoveryMode,
			).toBe(true);
		});

		it("repairs stale legacy choices when the earlier consolidation is marked complete", async () => {
			const loadedSettings = {
				...structuredClone(DEFAULT_SETTINGS),
				choices: [
					{
						id: "daily-note",
						name: "Open Daily Note",
						type: "Template",
						setFileExistsBehavior: true,
						fileExistsMode: "Nothing",
					},
				],
				migrations: allOtherMigrationsComplete("repairTemplateFileExistsBehavior"),
			};

			settingsStore.replaceState(loadedSettings as any);
			mockPlugin = {
				manifest: { version: "2.12.2" },
				settings: structuredClone(loadedSettings),
				saveSettings: vi.fn(),
			};
			unsubscribe = settingsStore.subscribe((settings) => {
				mockPlugin.settings = settings;
				void mockPlugin.saveSettings();
			});

			await migrate(mockPlugin);

			expect(mockPlugin.settings.choices[0]).toMatchObject({
				fileExistsBehavior: { kind: "apply", mode: "doNothing" },
			});
			expect(mockPlugin.settings.choices[0]).not.toHaveProperty(
				"setFileExistsBehavior",
			);
			expect(mockPlugin.settings.choices[0]).not.toHaveProperty(
				"fileExistsMode",
			);
			expect(
				mockPlugin.settings.migrations.repairTemplateFileExistsBehavior,
			).toBe(true);
		});
	});
});

/**
 * Regression coverage for the secret-hygiene bug: a migration that could not
 * complete its work (e.g. SecretStorage was unavailable on this launch) must
 * NOT be permanently marked done. Otherwise legacy plaintext API keys are left
 * in data.json forever and never retried once SecretStorage becomes available.
 */
describe("Migration completeness signal (retry on incomplete)", () => {

	function mapBackedSecretStorage() {
		const store = new Map<string, string>();
		return {
			store,
			secretStorage: {
				getSecret: (id: string) => store.get(id) ?? null,
				setSecret: (id: string, value: string) => {
					store.set(id, value);
				},
			},
		};
	}

	function seedLegacyProvider(apiKey: string) {
		return {
			...structuredClone(DEFAULT_SETTINGS),
			ai: {
				...structuredClone(DEFAULT_SETTINGS.ai),
				providers: [
					{
						name: "OpenAI",
						endpoint: "https://api.openai.com/v1",
						apiKey,
						models: [],
						modelSource: "providerApi" as const,
					},
				],
			},
			migrations: allOtherMigrationsComplete(
				"migrateProviderApiKeysToSecretStorage",
			),
		};
	}

	beforeEach(() => {
		settingsStore.replaceState(structuredClone(DEFAULT_SETTINGS));
	});

	afterEach(() => {
		settingsStore.replaceState(structuredClone(DEFAULT_SETTINGS));
	});

	it("leaves the secret migration pending when SecretStorage is unavailable, then completes on a later SecretStorage-capable launch", async () => {
		const loaded = seedLegacyProvider("sk-legacy-plaintext");

		// Launch 1: old Obsidian / mobile - no SecretStorage.
		settingsStore.replaceState(structuredClone(loaded));
		const launch1: any = {
			app: {},
			settings: structuredClone(loaded),
			saveSettings: vi.fn(),
		};
		await migrate(launch1);

		// The plaintext key cannot be moved, so the migration must stay pending
		// and the key must remain intact (still resolvable via the fallback).
		expect(
			launch1.settings.migrations.migrateProviderApiKeysToSecretStorage,
		).toBe(false);
		expect(launch1.settings.ai.providers[0].apiKey).toBe(
			"sk-legacy-plaintext",
		);

		// Launch 2: user upgraded / opened on desktop - SecretStorage now exists.
		const { store, secretStorage } = mapBackedSecretStorage();
		settingsStore.replaceState(structuredClone(launch1.settings));
		const launch2: any = {
			app: { secretStorage },
			settings: structuredClone(launch1.settings),
			saveSettings: vi.fn(),
		};
		await migrate(launch2);

		const migratedProvider = launch2.settings.ai.providers[0];
		expect(
			launch2.settings.migrations.migrateProviderApiKeysToSecretStorage,
		).toBe(true);
		expect(migratedProvider.apiKey).toBe("");
		expect(migratedProvider.apiKeyRef).toBeTruthy();
		expect(store.get(migratedProvider.apiKeyRef)).toBe("sk-legacy-plaintext");
	});

	it("leaves the secret migration pending when a provider key fails to move", async () => {
		const loaded = seedLegacyProvider("sk-legacy-plaintext");
		settingsStore.replaceState(structuredClone(loaded));

		const secretStorage = {
			getSecret: vi.fn().mockReturnValue(null),
			setSecret: vi.fn(() => {
				throw new Error("write failed");
			}),
		};
		const plugin: any = {
			app: { secretStorage },
			settings: structuredClone(loaded),
			saveSettings: vi.fn(),
		};

		await migrate(plugin);

		expect(
			plugin.settings.migrations.migrateProviderApiKeysToSecretStorage,
		).toBe(false);
		expect(plugin.settings.ai.providers[0].apiKey).toBe("sk-legacy-plaintext");
	});

	it("completes the secret migration on a SecretStorage-less build when there is nothing to migrate", async () => {
		const loaded = {
			...structuredClone(DEFAULT_SETTINGS),
			ai: {
				...structuredClone(DEFAULT_SETTINGS.ai),
				providers: [
					{
						name: "OpenAI",
						endpoint: "https://api.openai.com/v1",
						apiKey: "",
						apiKeyRef: "quickadd-ai-openai",
						models: [],
						modelSource: "providerApi" as const,
					},
				],
			},
			migrations: allOtherMigrationsComplete(
				"migrateProviderApiKeysToSecretStorage",
			),
		};
		settingsStore.replaceState(structuredClone(loaded));

		// No SecretStorage AND no plaintext key: the goal already holds, so the
		// migration should drain instead of re-running forever.
		const plugin: any = {
			app: {},
			settings: structuredClone(loaded),
			saveSettings: vi.fn(),
		};

		await migrate(plugin);

		expect(
			plugin.settings.migrations.migrateProviderApiKeysToSecretStorage,
		).toBe(true);
	});

	it("marks the secret migration complete when there are no plaintext keys to move", async () => {
		const loaded = {
			...structuredClone(DEFAULT_SETTINGS),
			ai: {
				...structuredClone(DEFAULT_SETTINGS.ai),
				providers: [
					{
						name: "OpenAI",
						endpoint: "https://api.openai.com/v1",
						apiKey: "",
						apiKeyRef: "quickadd-ai-openai",
						models: [],
						modelSource: "providerApi" as const,
					},
				],
			},
			migrations: allOtherMigrationsComplete(
				"migrateProviderApiKeysToSecretStorage",
			),
		};
		settingsStore.replaceState(structuredClone(loaded));

		const { secretStorage } = mapBackedSecretStorage();
		const plugin: any = {
			app: { secretStorage },
			settings: structuredClone(loaded),
			saveSettings: vi.fn(),
		};

		await migrate(plugin);

		expect(
			plugin.settings.migrations.migrateProviderApiKeysToSecretStorage,
		).toBe(true);
	});
});
