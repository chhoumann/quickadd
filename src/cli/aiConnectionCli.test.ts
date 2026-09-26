import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliData } from "obsidian";
import type { AIProvider } from "../ai/Provider";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";

const mocks = vi.hoisted(() => ({
	discoverProviderModels: vi.fn(),
	resolveProviderApiKey: vi.fn(),
}));
vi.mock("../ai/modelDiscoveryService", () => ({
	discoverProviderModels: mocks.discoverProviderModels,
}));
vi.mock("../ai/providerSecrets", () => ({
	resolveProviderApiKey: mocks.resolveProviderApiKey,
}));

import { aiTestConnectionHandler } from "./aiConnectionCli";

const SECRET = "sk-test-not-a-real-key-123";

function provider(overrides: Partial<AIProvider>): AIProvider {
	return {
		id: "openai",
		name: "OpenAI",
		endpoint: "https://api.openai.com/v1",
		apiKey: "",
		apiKeyRef: "openai-key",
		models: [],
		modelSource: "modelsDev",
		...overrides,
	};
}

const plugin = { app: {} } as unknown as QuickAdd;
const run = (params: Record<string, string>) =>
	aiTestConnectionHandler(plugin, params as unknown as CliData);

describe("quickadd:ai-test-connection", () => {
	beforeEach(() => {
		mocks.discoverProviderModels.mockReset();
		mocks.resolveProviderApiKey.mockReset();
		mocks.resolveProviderApiKey.mockResolvedValue(SECRET);
		settingsStore.setState({
			ai: {
				...settingsStore.getState().ai,
				providers: [provider({}), provider({ id: "work", name: "Work OpenAI" })],
			},
		});
	});

	it("tests the provider's own endpoint and reports the count, never the key", async () => {
		mocks.discoverProviderModels.mockResolvedValue([{ name: "a" }, { name: "b" }]);

		const result = await run({ provider: "work OPENAI" });

		expect(result).toEqual({ provider: "work", ok: true, modelCount: 2, apiKeyLinked: true });
		expect(mocks.discoverProviderModels).toHaveBeenCalledWith(
			expect.objectContaining({ id: "work", modelSource: "providerApi" }),
			SECRET,
		);
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	it("reports the provider's error", async () => {
		mocks.resolveProviderApiKey.mockResolvedValue("");
		mocks.discoverProviderModels.mockRejectedValue(new Error("HTTP 401: missing bearer"));

		expect(await run({ provider: "openai" })).toEqual({
			provider: "openai",
			ok: false,
			error: "HTTP 401: missing bearer",
			apiKeyLinked: false,
		});
	});

	it("lists provider ids when the selector is missing or unknown", async () => {
		expect(await run({})).toMatchObject({ ok: false, providers: ["openai", "work"] });
		expect(await run({ provider: "nope" })).toMatchObject({
			ok: false,
			error: 'No AI provider matches "nope".',
		});
		expect(mocks.discoverProviderModels).not.toHaveBeenCalled();
	});
});
