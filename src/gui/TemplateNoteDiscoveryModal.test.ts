import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TemplateChoice } from "src/types/choices/TemplateChoice";
import type { DiscoveryCandidate } from "src/utils/templateNoteDiscovery";
import { TemplateNoteDiscoveryModal } from "./TemplateNoteDiscoveryModal";

const candidates: DiscoveryCandidate[] = [
	{ item: "@quickadd-existing-note:Existing/Alice.md", title: "Alice", display: "Alice Existing/Alice.md A. Example", exactKeys: ["alice", "existing/alice", "a. example"], renderPath: "Existing/Alice.md" },
	{ item: "@quickadd-unresolved-note:Projects/Missing Roadmap", title: "Missing Roadmap", display: "Projects/Missing Roadmap", exactKeys: ["projects/missing roadmap"], unresolvedTitle: "Projects/Missing Roadmap" },
];

function modal() {
	return new TemplateNoteDiscoveryModal({} as App, new TemplateChoice("Project"), candidates);
}

describe("native Template discovery rows", () => {
	it.each(candidates)("keeps a typed internal identifier separate from its candidate: $item", async (candidate) => {
		const picker = modal();
		const suggestions = picker.getSuggestions(candidate.item);
		expect(suggestions[0].item).toEqual({ kind: "create", title: candidate.item });
		picker.selectSuggestion(suggestions[0], new KeyboardEvent("keydown", { key: "Enter" }));
		await expect(picker.promise).resolves.toMatchObject({ kind: "create", title: candidate.item });
	});

	it.each([
		["Alice", { kind: "existing", path: "Existing/Alice.md" }],
		["Projects/Missing Roadmap", { kind: "create", title: "Projects/Missing Roadmap", vaultRelativePath: "Projects/Missing Roadmap" }],
	])("preserves selected candidate identity for %s", async (query, expected) => {
		const picker = modal();
		const suggestions = picker.getSuggestions(String(query));
		expect(suggestions[0].item.kind).toBe("candidate");
		picker.selectSuggestion(suggestions[0], new MouseEvent("click"));
		await expect(picker.promise).resolves.toEqual(expected);
	});

	it.each(["Alice", "Existing/Alice.md", "A. Example", "Projects/Missing Roadmap"])("does not offer duplicate creation for exact public key %s", (query) => {
		const picker = modal();
		void picker.promise.catch(() => {});
		expect(picker.getSuggestions(query).some(match => match.item.kind === "create")).toBe(false);
		picker.close();
	});

	it("does not insert internal identifiers when Tab is pressed", () => {
		const picker = modal();
		void picker.promise.catch(() => {});
		picker.inputEl.value = "Alice";
		picker.getSuggestions("Alice");
		picker.inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true }));
		expect(picker.inputEl.value).toBe("Alice");
		picker.close();
	});

	it("settles cancellation when dismissed without a selection", async () => {
		const picker = modal();
		picker.close();
		await expect(picker.promise).rejects.toThrow("cancelled");
	});

	it("rejects an invalid custom title without leaving the promise pending", async () => {
		const picker = modal();
		picker.onChooseItem({ kind: "create", title: "../outside" });
		await expect(picker.promise).rejects.toThrow();
	});
});
