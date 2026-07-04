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
