import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const scriptPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../docs/public/scripts/getLongLatFromAddress.js",
);

type Entry = (params: unknown) => Promise<void>;

function loadScript(): Entry {
	const source = readFileSync(scriptPath, "utf8");
	const module = { exports: {} as Entry };
	new Function("module", "exports", source)(module, module.exports);
	return module.exports;
}

function run(options: {
	address?: string;
	results?: Array<{ lat: string; lon: string }>;
	frontmatter?: Record<string, unknown>;
	activeFile?: boolean;
	requestError?: Error;
}) {
	const frontmatter = options.frontmatter ?? {};
	const notices: string[] = [];
	const requestUrl = vi.fn(async (_request: { url: string }) => {
		if (options.requestError) throw options.requestError;
		return { json: options.results ?? [] };
	});
	const processFrontMatter = vi.fn(
		async (_file: unknown, fn: (fm: Record<string, unknown>) => void) =>
			fn(frontmatter),
	);
	const startFile = { path: "Places/Eiffel Tower.md", basename: "Eiffel Tower" };
	let activeFile: typeof startFile | null =
		options.activeFile === false ? null : startFile;
	const inputPrompt = vi.fn(async (_header: string) => {
		// While the prompt is open, Peek lets the user open another note.
		activeFile = { path: "Contacts/Eiffel Tower.md", basename: "Eiffel Tower" };
		return options.address;
	});

	const params = {
		app: {
			workspace: {
				getActiveFile: () => activeFile,
			},
			fileManager: { processFrontMatter },
		},
		obsidian: {
			requestUrl,
			Notice: class {
				constructor(message: string) {
					notices.push(message);
				}
			},
		},
		quickAddApi: { inputPrompt },
	};

	return {
		done: loadScript()(params),
		frontmatter,
		notices,
		requestUrl,
		processFrontMatter,
		inputPrompt,
		startFile,
	};
}

describe("getLongLatFromAddress example script", () => {
	it("writes the first result as a Map View `lat,lng` string and keeps other properties", async () => {
		const ctx = run({
			address: "Eiffel Tower, Paris",
			results: [
				{ lat: "48.8582599", lon: "2.2945006" },
				{ lat: "1", lon: "2" },
			],
			frontmatter: { tags: ["travel"] },
		});
		await ctx.done;

		expect(ctx.frontmatter).toEqual({
			tags: ["travel"],
			location: "48.8582599,2.2945006",
		});
		expect(ctx.notices).toEqual([]);
	});

	it("writes to the note open when the macro started, even if another note is active on submit", async () => {
		const ctx = run({
			address: "Eiffel Tower, Paris",
			results: [{ lat: "48.8582599", lon: "2.2945006" }],
		});
		await ctx.done;

		expect(ctx.inputPrompt).toHaveBeenCalledWith("🏠 Address for Places/Eiffel Tower.md");
		expect(ctx.processFrontMatter).toHaveBeenCalledTimes(1);
		expect(ctx.processFrontMatter.mock.calls[0][0]).toBe(ctx.startFile);
	});

	it("replaces an existing location", async () => {
		const ctx = run({
			address: "Colosseum, Rome",
			results: [{ lat: "41.8909421", lon: "12.4919030" }],
			frontmatter: { location: "[47.5939700, 14.1245600]" },
		});
		await ctx.done;

		expect(ctx.frontmatter.location).toBe("41.8909421,12.4919030");
	});

	it("sends the whole address to Nominatim, including `&` and `#`", async () => {
		const address = "AT&T Stadium #1, Arlington, Texas";
		const ctx = run({
			address,
			results: [{ lat: "32.7478503", lon: "-97.0928337" }],
		});
		await ctx.done;

		const url = new URL(ctx.requestUrl.mock.calls[0][0].url);
		expect(url.origin + url.pathname).toBe(
			"https://nominatim.openstreetmap.org/search",
		);
		expect(url.searchParams.get("q")).toBe(address);
		expect(url.searchParams.get("format")).toBe("json");
		expect(url.hash).toBe("");
	});

	it("leaves the note unchanged and shows a notice when nothing is found", async () => {
		const ctx = run({ address: "nowhere", results: [] });
		await ctx.done;

		expect(ctx.processFrontMatter).not.toHaveBeenCalled();
		expect(ctx.notices).toEqual(['No results found for "nowhere"']);
	});

	it("shows a notice and leaves the note unchanged when the lookup fails", async () => {
		const ctx = run({
			address: "Paris",
			requestError: new Error("Request failed, status 429"),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		await expect(ctx.done).resolves.toBeUndefined();

		expect(ctx.processFrontMatter).not.toHaveBeenCalled();
		expect(ctx.notices).toEqual([
			'Could not look up "Paris": Request failed, status 429',
		]);
	});

	it("does not prompt or geocode without an active file", async () => {
		const ctx = run({ activeFile: false, address: "Paris" });
		await ctx.done;

		expect(ctx.inputPrompt).not.toHaveBeenCalled();
		expect(ctx.requestUrl).not.toHaveBeenCalled();
		expect(ctx.notices).toEqual(["No active file"]);
	});

	it("does not geocode when the prompt is cancelled", async () => {
		const ctx = run({ address: undefined });
		await ctx.done;

		expect(ctx.requestUrl).not.toHaveBeenCalled();
		expect(ctx.processFrontMatter).not.toHaveBeenCalled();
		expect(ctx.notices).toEqual(["No address given"]);
	});
});
