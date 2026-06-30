import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import migrate from "./migrate";

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
		it("should verify migrations are tracked correctly", async () => {
			// Create a simple mock migration function
			const mockMigration = {
				description: "Test migration",
				migrate: vi.fn().mockResolvedValue(undefined)
			};

			// Simulate the migration tracking pattern from migrate.ts
			const migrationName = "testMigration";
			
			// Initially not run
			expect(mockPlugin.settings.migrations[migrationName]).toBeUndefined();
			
			// Run migration
			await mockMigration.migrate(mockPlugin);
			mockPlugin.settings.migrations[migrationName] = true;
			
			// Should be marked as completed
			expect(mockPlugin.settings.migrations[migrationName]).toBe(true);
			expect(mockMigration.migrate).toHaveBeenCalledWith(mockPlugin);
		});

		it("should not run completed migrations", () => {
			// Mock a completed migration
			mockSettings.migrations.testMigration = true;
			
			// The key insight: migrations should check this flag before running
			const shouldRun = !mockPlugin.settings.migrations.testMigration;
			
			expect(shouldRun).toBe(false);
		});

		it("should handle migration errors safely with backup", async () => {
			const originalSettings = { ...mockSettings };
			
			// Mock a failing migration
			const failingMigration = {
				description: "Failing migration",
				migrate: vi.fn().mockRejectedValue(new Error("Migration failed"))
			};

			try {
				await failingMigration.migrate(mockPlugin);
			} catch {
				// Restore backup on failure (pattern from migrate.ts)
				mockPlugin.settings = originalSettings;
			}

			// Settings should be restored
			expect(mockPlugin.settings).toEqual(originalSettings);
		});

		it("should demonstrate safe migration sequence pattern", async () => {
			// This test demonstrates the key pattern we need to verify:
			// Multiple migrations can run in sequence without conflicts
			
			const migration1 = {
				description: "First migration",
				migrate: vi.fn(async (plugin) => {
					// Migration 1 adds a property
					plugin.settings.newProperty1 = "value1";
				})
			};
			
			const migration2 = {
				description: "Second migration", 
				migrate: vi.fn(async (plugin) => {
					// Migration 2 can safely access what migration 1 added
					if (plugin.settings.newProperty1) {
						plugin.settings.newProperty2 = "value2";
					}
				})
			};

			// Run migrations in sequence
			await migration1.migrate(mockPlugin);
			mockPlugin.settings.migrations.migration1 = true;
			
			await migration2.migrate(mockPlugin);
			mockPlugin.settings.migrations.migration2 = true;

			// Both should have completed successfully
			expect(mockPlugin.settings.newProperty1).toBe("value1");
			expect(mockPlugin.settings.newProperty2).toBe("value2");
			expect(mockPlugin.settings.migrations.migration1).toBe(true);
			expect(mockPlugin.settings.migrations.migration2).toBe(true);
		});

		it("should demonstrate idempotent migration pattern", async () => {
			// This tests the key safety pattern: migrations should be safe to run multiple times
			
			const idempotentMigration = {
				description: "Idempotent migration",
				migrate: vi.fn(async (plugin) => {
					// Only modify if not already migrated
					if (!plugin.settings.alreadyMigrated) {
						plugin.settings.migratedData = "migrated";
						plugin.settings.alreadyMigrated = true;
					}
				})
			};

			// Run migration twice
			await idempotentMigration.migrate(mockPlugin);
			const afterFirstRun = { ...mockPlugin.settings };
			
			await idempotentMigration.migrate(mockPlugin);
			const afterSecondRun = { ...mockPlugin.settings };

			// State should be identical after both runs
			expect(afterFirstRun).toEqual(afterSecondRun);
			expect(mockPlugin.settings.migratedData).toBe("migrated");
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

			// First migration: convert macroId references to embedded macros
			const migration1 = {
				migrate: async (plugin: any) => {
					// Find choices with macroId and embed the macro
					for (const choice of plugin.settings.choices) {
						if (choice.type === "Macro" && choice.macroId) {
							const macro = plugin.settings.macros?.find((m: any) => m.id === choice.macroId);
							if (macro) {
								choice.macro = { ...macro };
								delete choice.macroId;
							}
						}
					}
				}
			};

			// Second migration: remove old macros array
			const migration2 = {
				migrate: async (plugin: any) => {
					// Remove old macros array
					delete plugin.settings.macros;
				}
			};

			// Run both migrations
			await migration1.migrate(mockPlugin);
			mockPlugin.settings.migrations.migration1 = true;
			
			await migration2.migrate(mockPlugin);
			mockPlugin.settings.migrations.migration2 = true;

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

			// Import and run the actual removeMacroIndirection migration
			const removeMacroIndirection = (await import("./removeMacroIndirection")).default;
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

			// Import and run the actual removeMacroIndirection migration
			const removeMacroIndirection = (await import("./removeMacroIndirection")).default;
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

			// Import and run the actual removeMacroIndirection migration
			const removeMacroIndirection = (await import("./removeMacroIndirection")).default;
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

			// Import and run the actual removeMacroIndirection migration
			const removeMacroIndirection = (await import("./removeMacroIndirection")).default;
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

			// Import and run the actual removeMacroIndirection migration
			const removeMacroIndirection = (await import("./removeMacroIndirection")).default;
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
	function allOtherMigrationsComplete(
		except: keyof typeof DEFAULT_SETTINGS.migrations,
	) {
		const flags = Object.fromEntries(
			Object.keys(DEFAULT_SETTINGS.migrations).map((key) => [key, true]),
		) as typeof DEFAULT_SETTINGS.migrations;
		flags[except] = false;
		return flags;
	}

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
