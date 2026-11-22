// @vitest-environment jsdom
import { TFile, type App } from "obsidian";
import { describe, expect, it } from "vitest";
import { FieldLinkOptions, type FieldLinkVault } from "src/utils/fieldLinkValues";
import { FieldLinkSuggester } from "./fieldLinkSuggester";

function note(basename: string): TFile {
	return Object.assign(new TFile(), { path: `${basename}.md`, name: `${basename}.md`, basename, extension: "md" });
}

const FILES = [note("Ted Chiang"), note("Books"), note("Neal Stephenson")];
const VAULT: FieldLinkVault = {
	files: FILES,
	resolve: (target) => FILES.find((file) => file.basename.toLowerCase() === target.toLowerCase()) ?? null,
	linkFor: (file) => `[[${file.basename}]]`,
	describe: (files) => files.map((file) => ({ label: file.basename, aliases: file.basename === "Neal Stephenson" ? ["Neal"] : [] })),
};

function picker(values: string[] = ["[[Books]]", "[[Missing]]"]) {
	const modal = new FieldLinkSuggester({} as App, new FieldLinkOptions(values, VAULT), "Enter value for author");
	void modal.promise.catch(() => {});
	return modal;
}

function rendered(modal: FieldLinkSuggester, query: string): HTMLElement[] {
	return modal.getSuggestions(query).map((match) => {
		const el = document.createElement("div");
		modal.renderSuggestion(match, el);
		return el;
	});
}

describe("FieldLinkSuggester", () => {
	it("opens on the property's values, by name, unresolved ones marked", () => {
		const rows = rendered(picker(), "");
		expect(rows.map((row) => row.textContent)).toEqual(["Books", "Missing"]);
		expect(rows[0].querySelector(".qa-field-link:not(.is-unresolved)")).not.toBeNull();
		expect(rows[1].querySelector(".qa-field-link.is-unresolved")).not.toBeNull();
	});

	it("says what to do when the property has no values yet", () => {
		expect(picker([]).emptyStateText).toBe("No existing values yet. Type to search notes or create a link.");
		expect(picker().emptyStateText).toBeUndefined();
	});

	it("shows an alias over the note it names", () => {
		const [row] = rendered(picker(), "Neal");
		expect(row.querySelector(".suggestion-title")?.textContent).toBe("Neal");
		expect(row.querySelector(".suggestion-note")?.textContent).toBe("Neal Stephenson");
		expect(row.querySelector('.suggestion-flair[aria-label="Alias"]')).not.toBeNull();
	});

	it("offers a link to a name no note has, after the matching notes", () => {
		const rows = rendered(picker(), "Chi");
		expect(rows.map((row) => row.textContent)).toEqual(["Ted Chiang", "Link to [[Chi]]"]);
	});

	it("resolves the picked note's link", async () => {
		const modal = picker();
		const [ted] = modal.getSuggestions("Ted Chiang");
		modal.selectSuggestion(ted, new KeyboardEvent("keydown", { key: "Enter" }));
		await expect(modal.promise).resolves.toBe("[[Ted Chiang]]");
	});

	it("resolves a new link without creating the note", async () => {
		const modal = picker();
		const created = modal.getSuggestions("Nobody").at(-1);
		if (!created) throw new Error("no suggestion");
		modal.selectSuggestion(created, new MouseEvent("click"));
		await expect(modal.promise).resolves.toBe("[[Nobody]]");
	});

	it("completes the note's name on Tab, not its link", () => {
		const modal = picker();
		Object.assign((modal as unknown as { chooser: object }).chooser, { values: modal.getSuggestions("Ted"), selectedItem: 0 });
		modal.inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
		expect(modal.inputEl.value).toBe("Ted Chiang");
		modal.close();
	});

	it("cancels the run when dismissed", async () => {
		const modal = new FieldLinkSuggester({} as App, new FieldLinkOptions([], VAULT), "x");
		modal.close();
		await expect(modal.promise).rejects.toThrow("cancelled");
	});
});
