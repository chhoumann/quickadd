import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type QuickAdd from "src/main";
import type { AIProvider } from "src/ai/Provider";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import { deepClone } from "src/utils/deepClone";

const { logWarningMock } = vi.hoisted(() => ({
	logWarningMock: vi.fn(),
}));

vi.mock("src/logger/logManager", () => ({
	log: {
		logWarning: logWarningMock,
		logMessage: vi.fn(),
		logError: vi.fn(),
	},
}));

const migration = await import("./migrateProviderApiKeysToSecretStorage");

type SecretStorageStub = {
	getSecret?: (name: string) => Promise<string | null> | string | null;
	setSecret?: (name: string, value: string) => Promise<void> | void;
};

function createProvider(overrides: Partial<AIProvider> = {}): AIProvider {
	return {
		name: "OpenAI",
		endpoint: "https://api.openai.com/v1",
		apiKey: "fake-test-key",
		models: [],
		modelSource: "providerApi",
		...overrides,
	};
}

function setup(
	providers: AIProvider[],
	secretStorage: SecretStorageStub | undefined,
): QuickAdd {
	const base = deepClone(DEFAULT_SETTINGS);
	settingsStore.replaceState({
		...base,
		ai: { ...base.ai, providers },
	});

	return {
		app: secretStorage ? { secretStorage } : {},
		saveSettings: vi.fn(),
	} as unknown as QuickAdd;
}

function readProviders(): AIProvider[] {
	return settingsStore.getState().ai.providers;
}

describe("migrateProviderApiKeysToSecretStorage migration", () => {
	beforeEach(() => {
		logWarningMock.mockReset();
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	afterEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	it("skips and warns when SecretStorage is unavailable, leaving keys untouched", async () => {
		const plugin = setup([createProvider({ apiKey: "fake-test-key" })], undefined);

		await migration.default.migrate(plugin);

		expect(readProviders()[0].apiKey).toBe("fake-test-key");
		expect(logWarningMock).toHaveBeenCalledWith(
			expect.stringContaining("SecretStorage unavailable"),
		);
	});

	it("clears the legacy key without overwriting an existing secret when apiKeyRef and secret exist", async () => {
		const getSecret = vi.fn().mockResolvedValue("fake-existing-secret");
		const setSecret = vi.fn();
		const plugin = setup(
			[createProvider({ apiKeyRef: "provider-secret", apiKey: "fake-test-key" })],
			{ getSecret, setSecret },
		);

		await migration.default.migrate(plugin);

		expect(setSecret).not.toHaveBeenCalled();
		expect(readProviders()[0].apiKey).toBe("");
		expect(readProviders()[0].apiKeyRef).toBe("provider-secret");
	});

	it("stores then clears when apiKeyRef is set but no secret exists yet", async () => {
		const getSecret = vi.fn().mockResolvedValue(null);
		const setSecret = vi.fn().mockResolvedValue(undefined);
		const plugin = setup(
			[createProvider({ apiKeyRef: "provider-secret", apiKey: "fake-test-key" })],
			{ getSecret, setSecret },
		);

		await migration.default.migrate(plugin);

		expect(setSecret).toHaveBeenCalledWith("provider-secret", "fake-test-key");
		expect(readProviders()[0].apiKey).toBe("");
		expect(readProviders()[0].apiKeyRef).toBe("provider-secret");
	});

	it("stores via helper, sets apiKeyRef, and clears the key when no apiKeyRef exists", async () => {
		const getSecret = vi.fn().mockResolvedValue(null);
		const setSecret = vi.fn().mockResolvedValue(undefined);
		const plugin = setup(
			[createProvider({ name: "OpenAI", apiKey: "fake-test-key" })],
			{ getSecret, setSecret },
		);

		await migration.default.migrate(plugin);

		expect(setSecret).toHaveBeenCalledWith("quickadd-ai-openai", "fake-test-key");
		expect(readProviders()[0].apiKeyRef).toBe("quickadd-ai-openai");
		expect(readProviders()[0].apiKey).toBe("");
	});

	it("is a no-op for a provider with no legacy key", async () => {
		const getSecret = vi.fn().mockResolvedValue(null);
		const setSecret = vi.fn();
		const plugin = setup(
			[createProvider({ apiKey: "", apiKeyRef: undefined })],
			{ getSecret, setSecret },
		);

		await migration.default.migrate(plugin);

		expect(setSecret).not.toHaveBeenCalled();
		expect(readProviders()[0].apiKey).toBe("");
		expect(readProviders()[0].apiKeyRef).toBeUndefined();
	});

	it("does not clear the key when setSecret throws", async () => {
		const getSecret = vi.fn().mockResolvedValue(null);
		const setSecret = vi.fn().mockRejectedValue(new Error("write failed"));
		const plugin = setup(
			[createProvider({ name: "OpenAI", apiKey: "fake-test-key" })],
			{ getSecret, setSecret },
		);

		await migration.default.migrate(plugin);

		expect(readProviders()[0].apiKey).toBe("fake-test-key");
		expect(readProviders()[0].apiKeyRef).toBeUndefined();
		expect(logWarningMock).toHaveBeenCalled();
	});

	it("signals incomplete when SecretStorage is unavailable", async () => {
		const plugin = setup([createProvider({ apiKey: "fake-test-key" })], undefined);

		const result = await migration.default.migrate(plugin);

		expect(result).toEqual({ complete: false });
	});

	it("signals incomplete when a legacy key cannot be moved", async () => {
		const getSecret = vi.fn().mockResolvedValue(null);
		const setSecret = vi.fn().mockRejectedValue(new Error("write failed"));
		const plugin = setup(
			[createProvider({ name: "OpenAI", apiKey: "fake-test-key" })],
			{ getSecret, setSecret },
		);

		const result = await migration.default.migrate(plugin);

		expect(result).toEqual({ complete: false });
	});

	it("signals complete once every legacy key has been moved", async () => {
		const getSecret = vi.fn().mockResolvedValue(null);
		const setSecret = vi.fn().mockResolvedValue(undefined);
		const plugin = setup(
			[createProvider({ name: "OpenAI", apiKey: "fake-test-key" })],
			{ getSecret, setSecret },
		);

		const result = await migration.default.migrate(plugin);

		expect(result).toBeUndefined();
		expect(readProviders()[0].apiKey).toBe("");
	});
});
