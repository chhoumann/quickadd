import { afterEach, describe, expect, it, vi } from "vitest";
import { RemotePromptProvider } from "./promptProvider";
import type { FieldRequirement } from "../preflight/RequirementCollector";
import type { interactivePromptServer } from "./interactivePromptServer";

type ServerLike = typeof interactivePromptServer;

/** A server stub that resolves every emitPrompt with a canned answer. */
function fakeServer(answer: unknown): ServerLike {
	return {
		emitPrompt: vi.fn(async () => answer),
	} as unknown as ServerLike;
}

function dateField(id: string): FieldRequirement {
	return { id, label: id, type: "date" };
}

afterEach(() => {
	delete (window as Window & { moment?: unknown }).moment;
	vi.clearAllMocks();
});

describe("RemotePromptProvider date marshaling", () => {
	it("datePrompt returns the full ISO when no dateFormat (matches QuickAddApi.datePrompt)", async () => {
		const provider = new RemotePromptProvider(
			"s",
			fakeServer("2025-12-10T15:41:11.393Z"),
		);
		expect(await provider.datePrompt("When")).toBe(
			"2025-12-10T15:41:11.393Z",
		);
	});

	it("datePrompt strips a leading @date: from the client answer", async () => {
		const provider = new RemotePromptProvider(
			"s",
			fakeServer("@date:2025-12-10T15:41:11.393Z"),
		);
		expect(await provider.datePrompt("When")).toBe(
			"2025-12-10T15:41:11.393Z",
		);
	});

	it("datePrompt formats with dateFormat when provided", async () => {
		(window as Window & { moment?: unknown }).moment = (iso: string) => ({
			isValid: () => Boolean(iso),
			format: (fmt: string) =>
				fmt === "YYYY-MM-DD" ? "2025-12-10" : `fmt-${fmt}`,
		});
		const provider = new RemotePromptProvider(
			"s",
			fakeServer("2025-12-10T15:41:11.393Z"),
		);
		expect(
			await provider.datePrompt("When", { dateFormat: "YYYY-MM-DD" }),
		).toBe("2025-12-10");
	});

	it("requestInputs wraps a date-field answer as @date:ISO, leaving other fields untouched", async () => {
		const provider = new RemotePromptProvider(
			"s",
			fakeServer({ d: "2025-12-10T15:41:11.393Z", name: "hi" }),
		);
		const out = await provider.requestInputs([
			dateField("d"),
			{ id: "name", label: "Name", type: "text" },
		]);
		expect(out.d).toBe("@date:2025-12-10T15:41:11.393Z");
		expect(out.name).toBe("hi");
	});

	it("requestInputs does not double-wrap an answer already prefixed with @date:", async () => {
		const provider = new RemotePromptProvider(
			"s",
			fakeServer({ d: "@date:2025-12-10T15:41:11.393Z" }),
		);
		const out = await provider.requestInputs([dateField("d")]);
		expect(out.d).toBe("@date:2025-12-10T15:41:11.393Z");
	});
});

describe("RemotePromptProvider suggester marshaling", () => {
	it("returns the original actualItems entry (object identity), not a stringified copy", async () => {
		const file = { basename: "note", path: "a/note.md" };
		const other = { basename: "x", path: "x.md" };
		let sentItems: { title: string; value: string }[] = [];
		const server = {
			emitPrompt: vi.fn(async (_id: string, spec: unknown) => {
				sentItems = (spec as { items: { title: string; value: string }[] })
					.items;
				// Client selects the first item by its opaque wire token.
				return sentItems[0].value;
			}),
		} as unknown as ServerLike;
		const provider = new RemotePromptProvider("s", server);

		const result = await provider.suggester(
			(f: unknown) => (f as { basename: string }).basename,
			[file, other] as unknown as string[],
			undefined,
			false,
		);

		// Same object reference back, exactly like GenericSuggester.
		expect(result).toBe(file);
		// Display function drives the title; the wire value is an opaque token,
		// never the stringified object.
		expect(sentItems[0].title).toBe("note");
		expect(sentItems[0].value).not.toBe("[object Object]");
	});

	it("returns a custom-typed value verbatim when allowCustomInput is set", async () => {
		const provider = new RemotePromptProvider(
			"s",
			fakeServer("typed custom"),
		);
		const result = await provider.suggester(["a"], ["a"], undefined, true);
		expect(result).toBe("typed custom");
	});

	it("suggesterMulti returns the selected actualItems entries and maps preselected to tokens", async () => {
		let spec: { items: { title: string; value: string }[]; preselected: string[] } =
			{ items: [], preselected: [] };
		const server = {
			emitPrompt: vi.fn(async (_id: string, s: unknown) => {
				spec = s as typeof spec;
				// Client selects the first and third items by their wire tokens.
				return [spec.items[0].value, spec.items[2].value];
			}),
		} as unknown as ServerLike;
		const provider = new RemotePromptProvider("s", server);

		const result = await provider.suggesterMulti(
			["A", "B", "C"],
			["a", "b", "c"],
			{ preselected: ["b"], placeholder: "pick" },
		);

		expect(result).toEqual(["a", "c"]);
		// Preselected "b" (index 1) is mapped to that item's opaque token.
		expect(spec.preselected).toEqual([spec.items[1].value]);
		expect(spec.items[0].title).toBe("A");
	});

	it("suggesterMulti keeps a preselected value that isn't in the item list (adds it as a pre-checked custom item)", async () => {
		let spec: { items: { title: string; value: string }[]; preselected: string[] } =
			{ items: [], preselected: [] };
		const server = {
			emitPrompt: vi.fn(async (_id: string, s: unknown) => {
				spec = s as typeof spec;
				// Accept the defaults (return exactly what was preselected).
				return spec.preselected;
			}),
		} as unknown as ServerLike;
		const provider = new RemotePromptProvider("s", server);

		// "active" is a default-from-active value not among the collected options.
		const result = await provider.suggesterMulti(["a", "b"], ["a", "b"], {
			preselected: ["a", "active"],
			allowCustomInput: true,
		});

		expect(result).toEqual(["a", "active"]);
		// "active" was appended as its own pre-checked item, not dropped.
		expect(spec.items.map((i) => i.title)).toContain("active");
		expect(spec.preselected).toHaveLength(2);
	});

	it("suggesterMulti keeps custom-typed values verbatim", async () => {
		const server = {
			emitPrompt: vi.fn(async () => ["custom-x"]),
		} as unknown as ServerLike;
		const provider = new RemotePromptProvider("s", server);
		const result = await provider.suggesterMulti(["A"], ["a"], {
			allowCustomInput: true,
		});
		expect(result).toEqual(["custom-x"]);
	});
});
