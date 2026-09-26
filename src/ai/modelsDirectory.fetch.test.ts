import { beforeEach, describe, expect, it, vi } from "vitest";

const storeState = vi.hoisted(() => ({ disableOnlineFeatures: false }));
const requestUrlMock = vi.hoisted(() => vi.fn());

vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<typeof import("obsidian")>()),
	requestUrl: requestUrlMock,
}));

vi.mock("src/settingsStore", () => ({
	settingsStore: { getState: () => storeState },
}));

const VALID = {
	openai: {
		id: "openai",
		name: "OpenAI",
		models: { "gpt-a": { id: "gpt-a" } },
	},
};

/** Fresh module = empty memory cache (as after an Obsidian restart). */
async function loadFetch() {
	vi.resetModules();
	const mod = await import("./modelsDirectory");
	return mod.fetchModelsDevDirectory;
}

describe("fetchModelsDevDirectory validation", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
		storeState.disableOnlineFeatures = false;
	});

	it("caches a valid directory for the session", async () => {
		const fetch = await loadFetch();
		requestUrlMock.mockResolvedValueOnce({ status: 200, json: VALID });

		expect(await fetch()).toEqual(VALID);
		expect(await fetch()).toEqual(VALID);
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});

	it.each([
		["an array body", []],
		["an empty object", {}],
		["a provider without models", { openai: { id: "openai", name: "OpenAI" } }],
	])("rejects %s without poisoning the memory cache", async (_label, body) => {
		const fetch = await loadFetch();
		requestUrlMock
			.mockResolvedValueOnce({ status: 200, json: body })
			.mockResolvedValueOnce({ status: 200, json: VALID });

		await expect(fetch()).rejects.toThrow(/unexpected response/);
		expect(await fetch()).toEqual(VALID);
		expect(requestUrlMock).toHaveBeenCalledTimes(2);
	});

	it("keeps the online-features gate", async () => {
		const fetch = await loadFetch();
		storeState.disableOnlineFeatures = true;

		await expect(fetch()).rejects.toThrow(/Online features are turned off/);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});
});
