import { describe, it, expect } from "vitest";
import {
	mapEndpointToModelsDevKey,
	mapModelsDevToQuickAdd,
	isChatCapableDirectoryModel,
	mergeModels,
	mergeSyncedModels,
	dropDatedSnapshots,
	type ModelsDevModel,
} from "./modelsDirectory";

describe("mapEndpointToModelsDevKey", () => {
	// Realistic provider base URLs should map to the right models.dev key.
	it.each([
		["https://api.openai.com/v1", "openai"],
		["https://openrouter.ai/api/v1", "openrouter"],
		["https://generativelanguage.googleapis.com/v1beta", "google"],
		["https://api.anthropic.com", "anthropic"],
		["https://api.groq.com/openai/v1", "groq"],
		["https://api.together.xyz/v1", "togetherai"],
		["https://together.ai/v1", "togetherai"],
		["https://router.huggingface.co/v1", "huggingface"],
		["https://models.github.ai/inference", "github-models"],
		["https://bedrock-runtime.us-east-1.amazonaws.com", "amazon-bedrock"],
		["https://api-inference.modelscope.cn/v1", "modelscope"],
		["https://dashscope.aliyuncs.com/compatible-mode/v1", "alibaba"],
		["https://api.fireworks.ai/inference/v1", "fireworks-ai"],
		["https://api.inference.net/v1", "inference"],
		["https://api.z.ai/api/paas/v4", "zhipuai"],
		["https://api.deepseek.com", "deepseek"],
		["https://api.cerebras.ai/v1", "cerebras"],
		["https://api.venice.ai/api/v1", "venice"],
		["https://api.upstage.ai/v1", "upstage"],
		["https://api.llama.com/v1", "llama"],
		["https://api.morphllm.com/v1", "morph"],
		["https://api.inceptionlabs.ai/v1", "inception"],
		["https://api.deepinfra.com/v1/openai", "deepinfra"],
		["https://gateway.opencode.ai/v1", "opencode"],
		["https://inference.wandb.ai/v1", "wandb"],
		["https://api.githubcopilot.com", "github-copilot"],
	])("maps %s -> %s", (endpoint, expected) => {
		expect(mapEndpointToModelsDevKey(endpoint)).toBe(expected);
	});

	it("matches the bare provider host without an api subdomain", () => {
		expect(mapEndpointToModelsDevKey("https://openai.com/v1")).toBe("openai");
	});

	it("accepts endpoints without a scheme", () => {
		expect(mapEndpointToModelsDevKey("api.openai.com/v1")).toBe("openai");
	});

	it("is case-insensitive", () => {
		expect(mapEndpointToModelsDevKey("https://API.OpenAI.COM/v1")).toBe("openai");
	});

	// Spoofing: a provider domain appearing in the path or in a different host
	// must NOT be classified as that provider (the CodeQL finding).
	it.each([
		"https://evil.com/api.openai.com/v1",
		"https://openai.com.evil.com/v1",
		"https://deepseek.com.attacker.example/v1",
		"https://api.openai.com@evil.com/v1",
	])("does not classify spoofed URL %s as any provider", (endpoint) => {
		expect(mapEndpointToModelsDevKey(endpoint)).toBeNull();
	});

	it("returns null for unknown or unparseable endpoints", () => {
		expect(mapEndpointToModelsDevKey("https://example.com/v1")).toBeNull();
		expect(mapEndpointToModelsDevKey("not a url")).toBeNull();
		expect(mapEndpointToModelsDevKey("")).toBeNull();
	});

	// Providers reached via proxy/custom URLs are intentionally matched by loose
	// keyword (these checks are deliberately not hostname-scoped).
	it.each([
		["https://my-anthropic-proxy.internal/v1", "anthropic"],
		["https://cerebras.internal.example/v1", "cerebras"],
		["https://my-huggingface-proxy.internal/v1", "huggingface"],
		["https://gateway.internal/deepinfra", "deepinfra"],
		["https://internal-bedrock.example/v1", "amazon-bedrock"],
		["https://zhipu-proxy.internal/v1", "zhipuai"],
	])("identifies %s via keyword/proxy fallback -> %s", (endpoint, expected) => {
		expect(mapEndpointToModelsDevKey(endpoint)).toBe(expected);
	});

	it("handles scheme-less endpoints that include a port", () => {
		expect(mapEndpointToModelsDevKey("api.openai.com:8443/v1")).toBe("openai");
	});
});

describe("mapModelsDevToQuickAdd", () => {
	it("maps id + context limit, flooring and clamping to >= 1", () => {
		const models: ModelsDevModel[] = [
			{ id: "gpt-x", limit: { context: 200000 } },
			{ id: "no-limit" },
			{ id: "tiny", limit: { context: 0.5 } },
		];
		expect(mapModelsDevToQuickAdd(models)).toEqual([
			{ name: "gpt-x", maxTokens: 200000 },
			{ name: "no-limit", maxTokens: 128000 },
			{ name: "tiny", maxTokens: 1 },
		]);
	});
});

describe("mapModelsDevToQuickAdd metadata", () => {
	it("carries output caps and sampling support from the directory", () => {
		const models: ModelsDevModel[] = [
			{
				id: "gpt-5.5",
				temperature: false,
				modalities: { output: ["text"] },
				limit: { context: 1050000, output: 128000 },
			},
			{
				id: "gpt-4o",
				temperature: true,
				modalities: { output: ["text"] },
				limit: { context: 128000, output: 16384 },
			},
		];
		expect(mapModelsDevToQuickAdd(models)).toEqual([
			{
				name: "gpt-5.5",
				maxTokens: 1050000,
				maxOutputTokens: 128000,
				supportsTemperature: false,
			},
			{
				name: "gpt-4o",
				maxTokens: 128000,
				maxOutputTokens: 16384,
				supportsTemperature: true,
			},
		]);
	});

	it("filters out non-chat entries", () => {
		const models: ModelsDevModel[] = [
			// Image generator: no context window (real shape from models.dev).
			{
				id: "gpt-image-2",
				modalities: { output: ["image"] },
				limit: { context: 0, output: 0 },
			},
			// TTS: no text output.
			{
				id: "gemini-2.5-flash-preview-tts",
				modalities: { output: ["audio"] },
				limit: { context: 8192, output: 16384 },
			},
			// Embeddings: text output but an embedding family / vector-dim output.
			{
				id: "text-embedding-3-small",
				family: "text-embedding",
				modalities: { output: ["text"] },
				limit: { context: 8191, output: 1536 },
			},
			{
				id: "gemini-embedding-001",
				family: "gemini",
				modalities: { output: ["text"] },
				limit: { context: 2048, output: 1 },
			},
			// A normal chat model survives.
			{
				id: "claude-fable-5",
				modalities: { output: ["text"] },
				limit: { context: 1000000, output: 128000 },
			},
		];
		expect(mapModelsDevToQuickAdd(models).map((m) => m.name)).toEqual([
			"claude-fable-5",
		]);
	});

	it("keeps unknown shapes (no positive evidence of being non-chat)", () => {
		expect(isChatCapableDirectoryModel({ id: "mystery" })).toBe(true);
	});
});

describe("mergeModels", () => {
	it("appends new models and refreshes metadata on existing ones", () => {
		const existing = [
			{ name: "gpt-4o", maxTokens: 4096 },
			{ name: "my-custom", maxTokens: 999 },
		];
		const incoming = [
			{
				name: "gpt-4o",
				maxTokens: 128000,
				maxOutputTokens: 16384,
				supportsTemperature: true,
			},
			{ name: "gpt-5.5", maxTokens: 1050000, supportsTemperature: false },
		];
		expect(mergeModels(existing, incoming)).toEqual([
			{
				name: "gpt-4o",
				maxTokens: 128000,
				maxOutputTokens: 16384,
				supportsTemperature: true,
			},
			{ name: "my-custom", maxTokens: 999 },
			{ name: "gpt-5.5", maxTokens: 1050000, supportsTemperature: false },
		]);
	});

	it("keeps existing metadata when the incoming entry lacks it", () => {
		const existing = [
			{
				name: "claude-sonnet-5",
				maxTokens: 200000,
				maxOutputTokens: 128000,
				supportsTemperature: false,
			},
		];
		// Anthropic's native models endpoint reports names only.
		const incoming = [{ name: "claude-sonnet-5", maxTokens: 1000000 }];
		expect(mergeModels(existing, incoming)).toEqual([
			{
				name: "claude-sonnet-5",
				maxTokens: 1000000,
				maxOutputTokens: 128000,
				supportsTemperature: false,
			},
		]);
	});
});

describe("model lifecycle metadata", () => {
	it("drops dated snapshots only when their undated id is listed", () => {
		const names = dropDatedSnapshots([
			{ name: "gpt-4o" },
			{ name: "gpt-4o-2024-11-20" },
			{ name: "claude-haiku-4-5" },
			{ name: "claude-haiku-4-5-20251001" },
			// No undated sibling: the snapshot is the only way to reach it.
			{ name: "gpt-4.5-preview-2025-02-27" },
			// A version number, not a date.
			{ name: "gemini-2.5-flash" },
		]).map((m) => m.name);

		expect(names).toEqual([
			"gpt-4o",
			"claude-haiku-4-5",
			"gpt-4.5-preview-2025-02-27",
			"gemini-2.5-flash",
		]);
	});

	it("maps release date and flags only deprecated directory entries", () => {
		const [current, retired] = mapModelsDevToQuickAdd([
			{ id: "gpt-6-sol", release_date: "2026-09-22", limit: { context: 1000, output: 100 } },
			{ id: "o4-mini", status: "deprecated", release_date: "2025-04-16", limit: { context: 1000, output: 100 } },
		]);

		expect(current).toEqual({ name: "gpt-6-sol", maxTokens: 1000, maxOutputTokens: 100, releaseDate: "2026-09-22" });
		expect(retired.deprecated).toBe(true);
		expect(retired.releaseDate).toBe("2025-04-16");
	});

	it("sync merges never add a deprecated model but do flag one the user has", () => {
		const existing = [{ name: "o4-mini", maxTokens: 200000 }];
		const incoming = [
			{ name: "o4-mini", maxTokens: 200000, deprecated: true },
			{ name: "o1", maxTokens: 200000, deprecated: true },
			{ name: "gpt-6-sol", maxTokens: 1050000, releaseDate: "2026-09-22" },
		];

		const merged = mergeSyncedModels(existing, incoming);

		expect(merged.map((m) => m.name)).toEqual(["o4-mini", "gpt-6-sol"]);
		expect(merged[0].deprecated).toBe(true);
		// An explicit import may still add a deprecated model on purpose.
		expect(mergeModels(existing, incoming).map((m) => m.name)).toContain("o1");
	});
});

describe("isChatCapableDirectoryModel name check", () => {
	it("drops realtime models even though the directory lists a text output", () => {
		// Live: gpt-realtime-2.1 returns 404 "not a chat model" on /v1/chat/completions.
		expect(
			isChatCapableDirectoryModel({
				id: "gpt-realtime-2.1",
				modalities: { input: ["text", "audio"], output: ["text", "audio"] },
				limit: { context: 128000, output: 32000 },
			}),
		).toBe(false);
		expect(
			isChatCapableDirectoryModel({
				id: "gpt-6-sol",
				modalities: { input: ["text"], output: ["text"] },
				limit: { context: 1050000, output: 128000 },
			}),
		).toBe(true);
	});
});
