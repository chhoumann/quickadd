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

const V1 = { openai: { id: "openai", name: "OpenAI", models: { "gpt-a": { id: "gpt-a" } } } };
const V2 = { openai: { id: "openai", name: "OpenAI", models: { "gpt-b": { id: "gpt-b" } } } };

/** A fake disk that outlives module re-imports, like the plugin folder outlives a restart. */
function fakeDisk(initial: string | null = null) {
	const disk = {
		contents: initial,
		writes: 0,
		read: vi.fn(async () => disk.contents),
		write: vi.fn(async (contents: string) => {
			disk.contents = contents;
			disk.writes += 1;
		}),
	};
	return disk;
}

function ok(data: unknown, headers: Record<string, string> = {}) {
	return { status: 200, headers, json: data };
}

function notModified() {
	return unparsableBody(304);
}

/** A response whose body is not JSON (empty or truncated): reading .json throws. */
function unparsableBody(status: number) {
	return {
		status,
		headers: {},
		get json(): unknown {
			throw new SyntaxError("Unexpected end of JSON input");
		},
	};
}

/** A fresh module instance: empty memory cache, as after an Obsidian restart. */
async function launch(disk: ReturnType<typeof fakeDisk>) {
	vi.resetModules();
	const mod = await import("./modelsDirectory");
	mod.setModelsDirectoryDiskCache(disk);
	return mod;
}

function sentHeaders(call: number): Record<string, string> | undefined {
	return requestUrlMock.mock.calls[call][0].headers;
}

describe("fetchModelsDevDirectory disk cache", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
		storeState.disableOnlineFeatures = false;
	});

	it("revalidates the saved copy with If-None-Match after a restart and reuses it on 304", async () => {
		const disk = fakeDisk();

		let mod = await launch(disk);
		requestUrlMock.mockResolvedValueOnce(ok(V1, { etag: '"v1"' }));
		expect(await mod.fetchModelsDevDirectory()).toEqual(V1);
		expect(sentHeaders(0)?.["If-None-Match"]).toBeUndefined();
		expect(JSON.parse(disk.contents!)).toEqual({ etag: '"v1"', data: V1 });

		mod = await launch(disk);
		requestUrlMock.mockResolvedValueOnce(notModified());
		expect(await mod.fetchModelsDevDirectory()).toEqual(V1);
		expect(sentHeaders(1)).toEqual({ "If-None-Match": '"v1"' });
		// A 304 carries no body; the saved copy must not be rewritten.
		expect(disk.writes).toBe(1);
	});

	it("replaces the saved copy and its ETag when the directory changed", async () => {
		const disk = fakeDisk(JSON.stringify({ etag: '"v1"', data: V1 }));
		const mod = await launch(disk);
		// Header names are matched case-insensitively.
		requestUrlMock.mockResolvedValueOnce(ok(V2, { ETag: '"v2"' }));

		expect(await mod.fetchModelsDevDirectory()).toEqual(V2);
		expect(sentHeaders(0)).toEqual({ "If-None-Match": '"v1"' });
		expect(JSON.parse(disk.contents!)).toEqual({ etag: '"v2"', data: V2 });

		const next = await launch(disk);
		requestUrlMock.mockResolvedValueOnce(notModified());
		expect(await next.fetchModelsDevDirectory()).toEqual(V2);
		expect(sentHeaders(1)).toEqual({ "If-None-Match": '"v2"' });
	});

	it("does not go back to the network within a session once loaded", async () => {
		const disk = fakeDisk(JSON.stringify({ etag: '"v1"', data: V1 }));
		const mod = await launch(disk);
		requestUrlMock.mockResolvedValue(notModified());

		await mod.fetchModelsDevDirectory();
		await mod.fetchModelsDevDirectory();
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});

	it("shares one request between concurrent callers", async () => {
		const disk = fakeDisk();
		const mod = await launch(disk);
		requestUrlMock.mockResolvedValue(ok(V1, { etag: '"v1"' }));

		const [a, b] = await Promise.all([
			mod.fetchModelsDevDirectory(),
			mod.fetchModelsDevDirectory(),
		]);
		expect(a).toEqual(V1);
		expect(b).toEqual(V1);
		expect(requestUrlMock).toHaveBeenCalledTimes(1);
	});

	it("falls back to the saved copy when revalidation fails", async () => {
		const disk = fakeDisk(JSON.stringify({ etag: '"v1"', data: V1 }));
		const mod = await launch(disk);
		requestUrlMock.mockRejectedValueOnce(new Error("net::ERR_INTERNET_DISCONNECTED"));

		expect(await mod.fetchModelsDevDirectory()).toEqual(V1);
	});

	it("still throws a network failure when nothing is saved", async () => {
		const mod = await launch(fakeDisk());
		requestUrlMock.mockRejectedValueOnce(new Error("net::ERR_INTERNET_DISCONNECTED"));

		await expect(mod.fetchModelsDevDirectory()).rejects.toThrow(
			"ERR_INTERNET_DISCONNECTED",
		);
	});

	it("keeps the online-features gate even when a saved copy exists", async () => {
		const disk = fakeDisk(JSON.stringify({ etag: '"v1"', data: V1 }));
		const mod = await launch(disk);
		storeState.disableOnlineFeatures = true;

		await expect(mod.fetchModelsDevDirectory()).rejects.toThrow(
			/Online features are turned off/,
		);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it.each([
		["a non-JSON body", unparsableBody(200)],
		["an array body", ok([])],
		["an empty object body", ok({})],
	])("keeps the saved copy when a 200 refresh has %s", async (_label, response) => {
		const saved = JSON.stringify({ etag: '"v1"', data: V1 });
		const disk = fakeDisk(saved);
		const mod = await launch(disk);
		requestUrlMock.mockResolvedValueOnce(response);

		expect(await mod.fetchModelsDevDirectory()).toEqual(V1);
		expect(disk.contents).toBe(saved);
	});

	it("throws on an unusable 200 when nothing is saved, without saving it", async () => {
		const disk = fakeDisk();
		const mod = await launch(disk);
		requestUrlMock.mockResolvedValueOnce(ok([]));

		await expect(mod.fetchModelsDevDirectory()).rejects.toThrow(
			/unexpected response/,
		);
		expect(disk.contents).toBeNull();
	});

	it.each([
		["corrupt JSON", "{not json"],
		["missing data", JSON.stringify({ etag: '"v1"' })],
		["empty data", JSON.stringify({ etag: '"v1"', data: {} })],
		["array data", JSON.stringify({ etag: '"v1"', data: [] })],
	])("treats a saved copy with %s as a miss", async (_label, contents) => {
		const disk = fakeDisk(contents);
		const mod = await launch(disk);
		requestUrlMock.mockResolvedValueOnce(ok(V2, { etag: '"v2"' }));

		expect(await mod.fetchModelsDevDirectory()).toEqual(V2);
		expect(sentHeaders(0)?.["If-None-Match"]).toBeUndefined();
		expect(JSON.parse(disk.contents!)).toEqual({ etag: '"v2"', data: V2 });
	});

	it("saves a response without an ETag but sends no validator next time", async () => {
		const disk = fakeDisk();
		let mod = await launch(disk);
		requestUrlMock.mockResolvedValueOnce(ok(V1));
		await mod.fetchModelsDevDirectory();

		mod = await launch(disk);
		requestUrlMock.mockResolvedValueOnce(ok(V2));
		expect(await mod.fetchModelsDevDirectory()).toEqual(V2);
		expect(sentHeaders(1)?.["If-None-Match"]).toBeUndefined();
	});

	it("returns fresh data even when saving it fails", async () => {
		const disk = fakeDisk();
		disk.write.mockRejectedValueOnce(new Error("EACCES"));
		const mod = await launch(disk);
		requestUrlMock.mockResolvedValueOnce(ok(V1, { etag: '"v1"' }));

		expect(await mod.fetchModelsDevDirectory()).toEqual(V1);
	});
});

describe("pluginFolderDirectoryCache", () => {
	it("stores the directory as a file in the plugin folder, not in data.json", async () => {
		const files = new Map<string, string>();
		const adapter = {
			exists: vi.fn(async (path: string) => files.has(path)),
			read: vi.fn(async (path: string) => files.get(path)!),
			write: vi.fn(async (path: string, data: string) => {
				files.set(path, data);
			}),
		};
		const { pluginFolderDirectoryCache } = await import("./modelsDirectory");
		const cache = pluginFolderDirectoryCache(adapter, ".obsidian/plugins/quickadd/");

		expect(await cache.read()).toBeNull();
		await cache.write("payload");
		expect([...files.keys()]).toEqual([
			".obsidian/plugins/quickadd/models-dev-cache.json",
		]);
		expect(await cache.read()).toBe("payload");
	});
});
