import { describe, expect, it } from "vitest";
import { CURRENT_MODEL_SEEDS } from "./Provider";

// Drift check for the shipped seed catalog. Opt-in because it hits the network:
//   LIVE_DISCOVERY_TESTS=1 pnpm vitest run src/ai/modelSeeds.live.test.ts
// With OPENAI_API_KEY set it also confirms every OpenAI seed is served by
// /v1/models. Only model ids are compared or reported, never account data.
const runLive = process.env.LIVE_DISCOVERY_TESTS === "1";
const openAIKey = process.env.OPENAI_API_KEY;

type DirectoryModel = {
	limit?: { context?: number; output?: number };
	temperature?: boolean;
};

(runLive ? describe : describe.skip)("shipped model seeds (live)", () => {
	it("match models.dev context, output, and sampling metadata", async () => {
		const response = await fetch("https://models.dev/api.json");
		const directory = (await response.json()) as Record<
			string,
			{ models: Record<string, DirectoryModel> }
		>;

		const drift: string[] = [];
		for (const [key, seeds] of Object.entries(CURRENT_MODEL_SEEDS)) {
			for (const seed of seeds) {
				const entry = directory[key]?.models[seed.name];
				const actual = entry && {
					maxTokens: entry.limit?.context,
					maxOutputTokens: entry.limit?.output,
					supportsTemperature: entry.temperature,
				};
				const expected = {
					maxTokens: seed.maxTokens,
					maxOutputTokens: seed.maxOutputTokens,
					supportsTemperature: seed.supportsTemperature,
				};
				if (JSON.stringify(actual) !== JSON.stringify(expected)) {
					drift.push(`${key}/${seed.name}: directory ${JSON.stringify(actual)}`);
				}
			}
		}
		expect(drift).toEqual([]);
	});

	(openAIKey ? it : it.skip)("lists every OpenAI seed in /v1/models", async () => {
		const response = await fetch("https://api.openai.com/v1/models", {
			headers: { Authorization: `Bearer ${openAIKey}` },
		});
		expect(response.status).toBe(200);
		const { data } = (await response.json()) as { data: Array<{ id: string }> };
		const served = new Set(data.map((model) => model.id));
		const missing = CURRENT_MODEL_SEEDS.openai
			.map((seed) => seed.name)
			.filter((name) => !served.has(name));
		expect(missing).toEqual([]);
	});
});
