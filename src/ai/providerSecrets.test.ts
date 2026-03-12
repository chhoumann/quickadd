import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { AIProvider } from "./Provider";

const { logWarningMock } = vi.hoisted(() => ({
	logWarningMock: vi.fn(),
}));

vi.mock("src/logger/logManager", () => ({
	log: {
		logWarning: logWarningMock,
	},
}));

const {
	resolveProviderApiKey,
	storeProviderApiKeyInSecretStorage,
} = await import("./providerSecrets");

function createProvider(overrides: Partial<AIProvider> = {}): AIProvider {
	return {
		name: "OpenAI",
		endpoint: "https://api.openai.com/v1",
		apiKey: "legacy-key",
		models: [],
		modelSource: "providerApi",
		...overrides,
	};
}

function createApp(secretStorage: {
	getSecret?: (name: string) => Promise<string | null> | string | null;
	setSecret?: (name: string, value: string) => Promise<void> | void;
}): App {
	return { secretStorage } as unknown as App;
}

describe("providerSecrets", () => {
	beforeEach(() => {
		logWarningMock.mockReset();
	});

	it("resolveProviderApiKey returns SecretStorage value when available", async () => {
		const getSecret = vi.fn().mockResolvedValue("secret-key");
		const app = createApp({ getSecret });
		const provider = createProvider({ apiKeyRef: "provider-secret" });

		const value = await resolveProviderApiKey(app, provider);

		expect(value).toBe("secret-key");
		expect(getSecret).toHaveBeenCalledWith("provider-secret");
	});

	it("resolveProviderApiKey falls back to provider apiKey and logs read errors", async () => {
		const getSecret = vi.fn().mockRejectedValue(new Error("boom"));
		const app = createApp({ getSecret });
		const provider = createProvider({ apiKeyRef: "missing-secret" });

		const value = await resolveProviderApiKey(app, provider);

		expect(value).toBe("legacy-key");
		expect(logWarningMock).toHaveBeenCalledWith(
			expect.stringContaining('Failed to read SecretStorage entry "missing-secret"'),
		);
	});

	it("storeProviderApiKeyInSecretStorage reuses existing matching secret", async () => {
		const getSecret = vi.fn().mockResolvedValue("stored-key");
		const setSecret = vi.fn();
		const app = createApp({ getSecret, setSecret });
		const provider = createProvider({ name: "OpenAI" });

		const secretName = await storeProviderApiKeyInSecretStorage(
			app,
			provider,
			"stored-key",
		);

		expect(secretName).toBe("quickadd-ai-openai");
		expect(setSecret).not.toHaveBeenCalled();
	});

	it("storeProviderApiKeyInSecretStorage appends suffix when base is occupied", async () => {
		const getSecret = vi
			.fn()
			.mockResolvedValueOnce("different-key")
			.mockResolvedValueOnce(null);
		const setSecret = vi.fn().mockResolvedValue(undefined);
		const app = createApp({ getSecret, setSecret });
		const provider = createProvider({ name: "OpenAI" });

		const secretName = await storeProviderApiKeyInSecretStorage(
			app,
			provider,
			"new-key",
		);

		expect(secretName).toBe("quickadd-ai-openai-2");
		expect(setSecret).toHaveBeenCalledWith("quickadd-ai-openai-2", "new-key");
	});

	it("storeProviderApiKeyInSecretStorage logs write errors and returns null", async () => {
		const getSecret = vi.fn().mockResolvedValue(null);
		const setSecret = vi.fn().mockRejectedValue(new Error("write failed"));
		const app = createApp({ getSecret, setSecret });
		const provider = createProvider();

		const secretName = await storeProviderApiKeyInSecretStorage(
			app,
			provider,
			"new-key",
		);

		expect(secretName).toBeNull();
		expect(logWarningMock).toHaveBeenCalledWith(
			expect.stringContaining('Failed to write SecretStorage entry "quickadd-ai-openai"'),
		);
	});
});
