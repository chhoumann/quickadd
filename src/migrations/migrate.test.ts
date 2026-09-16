import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import migrate from "./migrate";
import useQuickAddTemplateFolder from "./useQuickAddTemplateFolder";
import incrementFileNameSettingMoveToDefaultBehavior from "./incrementFileNameSettingMoveToDefaultBehavior";
import removeMacroIndirection from "./removeMacroIndirection";


function allOtherMigrationsComplete(
	except: keyof typeof DEFAULT_SETTINGS.migrations,
) {
	const flags = Object.fromEntries(
		Object.keys(DEFAULT_SETTINGS.migrations).map((key) => [key, true]),
	) as typeof DEFAULT_SETTINGS.migrations;
	flags[except] = false;
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
				migrations: {
					useQuickAddTemplateFolder: true,
					incrementFileNameSettingMoveToDefaultBehavior: true,
					consolidateFileExistsBehavior: false,
					repairTemplateFileExistsBehavior: true,
					mutualExclusionInsertAfterAndWriteToBottomOfFile: true,
					setVersionAfterUpdateModalRelease: true,
					addDefaultAIProviders: true,
					removeMacroIndirection: true,
					migrateFileOpeningSettings: true,
					backfillFileOpeningDefaults: true,
					setProviderModelDiscoveryMode: false,
					migrateProviderApiKeysToSecretStorage: true,
				},
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
				migrations: {
					useQuickAddTemplateFolder: true,
					incrementFileNameSettingMoveToDefaultBehavior: true,
					consolidateFileExistsBehavior: true,
					repairTemplateFileExistsBehavior: false,
					mutualExclusionInsertAfterAndWriteToBottomOfFile: true,
					setVersionAfterUpdateModalRelease: true,
					addDefaultAIProviders: true,
					removeMacroIndirection: true,
					migrateFileOpeningSettings: true,
					backfillFileOpeningDefaults: true,
					setProviderModelDiscoveryMode: true,
					migrateProviderApiKeysToSecretStorage: true,
				},
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

		it("should handle macro-related migration sequence", async () => {
			// This test verifies the specific pattern we're concerned about:
			// One migration embeds macros, another removes macro references
			
			// Setup: old settings with both patterns that need migration
			mockSettings = {
				choices: [
					{
						id: "choice1",
						type: "Macro",
						macroId: "macro1" // Old reference format
					}
				],
				macros: [
					{
						id: "macro1", 
						name: "Test Macro",
						commands: []
					}
				],
				migrations: {}
			};
			mockPlugin.settings = mockSettings;

			mockPlugin.settings.migrations = allOtherMigrationsComplete("removeMacroIndirection");
			await migrate(mockPlugin);

			// Verify final state is correct
			expect(mockPlugin.settings.macros).toBeUndefined();
			expect(mockPlugin.settings.choices[0].macro).toBeDefined();
			expect(mockPlugin.settings.choices[0].macroId).toBeUndefined();
			expect(mockPlugin.settings.choices[0].macro.name).toBe("Test Macro");
		});

		it("should handle multiple choices referencing same macroId", async () => {
			// This test verifies the critical bug fix: multiple choices can reference the same macro
			
			// Setup: multiple choices referencing the same macro
			mockSettings = {
				choices: [
					{
						id: "choice1",
						type: "Macro",
						name: "First Reference",
						macroId: "shared-macro"
					},
					{
						id: "choice2", 
						type: "Macro",
						name: "Second Reference",
						macroId: "shared-macro"
					},
					{
						id: "choice3",
						type: "Macro", 
						name: "Third Reference",
						macroId: "shared-macro"
					}
				],
				macros: [
					{
						id: "shared-macro",
						name: "Shared Macro",
						commands: [{ type: "UserScript", path: "test.js" }],
						runOnStartup: true
					}
				],
				migrations: {}
			};
			mockPlugin.settings = mockSettings;

			await removeMacroIndirection.migrate(mockPlugin);

			// Verify all choices now have the embedded macro
			expect(mockPlugin.settings.choices).toHaveLength(3);
			
			for (const choice of mockPlugin.settings.choices) {
				expect(choice.macro).toBeDefined();
				expect(choice.macro.id).toBe("shared-macro");
				expect(choice.macro.name).toBe("Shared Macro");
				expect(choice.macro.commands).toHaveLength(1);
				expect(choice.runOnStartup).toBe(true);
				expect(choice.macroId).toBeUndefined();
			}

			// Verify old macros array was removed
			expect(mockPlugin.settings.macros).toBeUndefined();
		});

		it("should handle orphaned macros without choice references", async () => {
			// This test verifies orphaned macros are converted to new choices
			
			// Setup: macro exists but no choices reference it
			mockSettings = {
				choices: [
					{
						id: "choice1",
						type: "Template",
						name: "Some Template"
					}
				],
				macros: [
					{
						id: "orphaned-macro",
						name: "Orphaned Macro",
						commands: [{ type: "UserScript", path: "orphaned.js" }],
						runOnStartup: false
					}
				],
				migrations: {}
			};
			mockPlugin.settings = mockSettings;

			await removeMacroIndirection.migrate(mockPlugin);

			// Verify orphaned macro was converted to a new choice
			expect(mockPlugin.settings.choices).toHaveLength(2);
			
			const newMacroChoice = mockPlugin.settings.choices.find((c: any) => c.type === "Macro");
			expect(newMacroChoice).toBeDefined();
			expect(newMacroChoice.name).toBe("Orphaned Macro");
			expect(newMacroChoice.macro).toBeDefined();
			expect(newMacroChoice.macro.id).toBe("orphaned-macro");
			expect(newMacroChoice.macro.commands).toHaveLength(1);
			expect(newMacroChoice.runOnStartup).toBe(false);
			expect(newMacroChoice.macroId).toBeUndefined();

			// Verify old macros array was removed
			expect(mockPlugin.settings.macros).toBeUndefined();
		});

		it("should handle orphaned macroId references without macro definitions", async () => {
			// This test verifies orphaned macroId references are cleaned up
			
			// Setup: choice references macro that doesn't exist in macros array
			mockSettings = {
				choices: [
					{
						id: "choice1",
						type: "Macro",
						name: "Orphaned Reference", 
						macroId: "missing-macro"
					}
				],
				macros: [], // Empty macros array
				migrations: {}
			};
			mockPlugin.settings = mockSettings;

			// Mock the logger to capture the log message
			const { log } = await import("src/logger/logManager");
			const logSpy = vi.spyOn(log, 'logMessage').mockImplementation(() => {});

			await removeMacroIndirection.migrate(mockPlugin);

			// Verify orphaned macroId was removed
			expect(mockPlugin.settings.choices[0].macroId).toBeUndefined();
			expect(mockPlugin.settings.choices[0].macro).toBeUndefined();
			
			// Verify warning was logged
			expect(logSpy).toHaveBeenCalledWith("Removing orphaned macroId reference: missing-macro");
			
			// Verify old macros array was removed
			expect(mockPlugin.settings.macros).toBeUndefined();
			
			logSpy.mockRestore();
		});

		it("should handle already-embedded macros without creating duplicates", async () => {
			// This test verifies the critical edge case: macros already embedded from previous beta builds
			
			// Setup: choice already has embedded macro but settings.macros still exists
			mockSettings = {
				choices: [
					{
						id: "choice1",
						type: "Macro",
						name: "Already Embedded",
						macro: {
							id: "embedded-macro",
							name: "Embedded Macro",
							commands: [{ type: "UserScript", path: "embedded.js" }]
						},
						runOnStartup: true
						// Note: no macroId property - this was already migrated
					}
				],
				macros: [
					{
						id: "embedded-macro",
						name: "Embedded Macro",
						commands: [{ type: "UserScript", path: "embedded.js" }],
						runOnStartup: true
					}
				],
				migrations: {}
			};
			mockPlugin.settings = mockSettings;

			await removeMacroIndirection.migrate(mockPlugin);

			// Verify no duplicate choices were created
			expect(mockPlugin.settings.choices).toHaveLength(1);
			
			// Verify the existing choice is unchanged
			const choice = mockPlugin.settings.choices[0];
			expect(choice.name).toBe("Already Embedded");
			expect(choice.macro).toBeDefined();
			expect(choice.macro.id).toBe("embedded-macro");
			expect(choice.macro.name).toBe("Embedded Macro");
			expect(choice.runOnStartup).toBe(true);
			expect(choice.macroId).toBeUndefined();

			// Verify old macros array was removed
			expect(mockPlugin.settings.macros).toBeUndefined();
		});

		it("should preserve custom runOnStartup values in already-embedded macros", async () => {
			// This test verifies that user-customized runOnStartup values are preserved
			
			// Setup: choice already has embedded macro with custom runOnStartup value
			mockSettings = {
				choices: [
					{
						id: "choice1",
						type: "Macro",
						name: "Custom Startup",
						macro: {
							id: "custom-macro",
							name: "Custom Macro",
							commands: [{ type: "UserScript", path: "custom.js" }]
						},
						runOnStartup: false // User manually set this to false
					}
				],
				macros: [
					{
						id: "custom-macro",
						name: "Custom Macro",
						commands: [{ type: "UserScript", path: "custom.js" }],
						runOnStartup: true // But the macro definition has true
					}
				],
				migrations: {}
			};
			mockPlugin.settings = mockSettings;

			await removeMacroIndirection.migrate(mockPlugin);

			// Verify the user's custom runOnStartup value is preserved
			const choice = mockPlugin.settings.choices[0];
			expect(choice.runOnStartup).toBe(false); // Should preserve user's false, not overwrite with macro's true
			
			// Verify other properties are correct
			expect(choice.macro.id).toBe("custom-macro");
			expect(choice.macro.name).toBe("Custom Macro");
			expect(choice.macroId).toBeUndefined();
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
