import { describe, expect, it } from "vitest";
import {
	ensureObsidianDomPolyfills,
	suggestInserts,
} from "../../../tests/suggesters/formatSuggesterHarness";
import { FormatSyntaxSuggester } from "./formatSyntaxSuggester";

const globalVariables = {
	Signature: "Logged by QuickAdd",
	MyProjects: "{{VALUE:Inbox,Work}}",
	Areas: "Work,Home",
};
const VARS = { globalVariables };

describe("FormatSyntaxSuggester {{GLOBAL_VAR:}} names", () => {
	it("keeps offering every defined variable once the colon is typed", async () => {
		expect(await suggestInserts("{{GLOBAL_VAR", VARS)).toEqual([
			"{{GLOBAL_VAR:}}",
			"{{GLOBAL_VAR:Signature}}",
			"{{GLOBAL_VAR:MyProjects}}",
			"{{GLOBAL_VAR:Areas}}",
		]);
		expect(await suggestInserts("{{GLOBAL_VAR:", VARS)).toEqual([
			"{{GLOBAL_VAR:Signature}}",
			"{{GLOBAL_VAR:MyProjects}}",
			"{{GLOBAL_VAR:Areas}}",
		]);
	});

	it("filters by the typed name prefix, case-insensitively", async () => {
		expect(await suggestInserts("{{GLOBAL_VAR:S", VARS)).toEqual([
			"{{GLOBAL_VAR:Signature}}",
		]);
		expect(await suggestInserts("{{global_var:my", VARS)).toEqual([
			"{{GLOBAL_VAR:MyProjects}}",
		]);
		expect(await suggestInserts("{{GLOBAL_VAR:Nope", VARS)).toEqual([]);
		expect(await suggestInserts("{{GLOBAL_VAR:")).toEqual([]);
	});

	it("leaves neighbouring colon tokens and closed tokens alone", async () => {
		expect(await suggestInserts("{{VALUE:S", VARS)).toEqual([]);
		expect(await suggestInserts("{{MACRO:S", VARS)).toEqual([]);
		expect(await suggestInserts("{{GLOBAL_VAR:Signature}} ", VARS)).toEqual([]);
		expect(await suggestInserts("{{GLOBAL_VAR:Signature}} {{VD", VARS)).toContain(
			"{{VDATE:}}",
		);
	});

	it("replaces the closing braces an accepted {{GLOBAL_VAR:}} row left after the caret", () => {
		ensureObsidianDomPolyfills();
		const app = {
			dom: { appContainerEl: document.body },
			keymap: { pushScope: () => {}, popScope: () => {} },
		} as any;
		const plugin = {
			settings: { choices: [], globalVariables },
			getTemplateFiles: () => [],
		} as any;
		const inputEl = document.createElement("textarea");
		inputEl.value = "- {{GLOBAL_VAR:My}} after";
		const caret = "- {{GLOBAL_VAR:My".length;
		inputEl.setSelectionRange(caret, caret);

		const suggester = new FormatSyntaxSuggester(app, inputEl, plugin);
		try {
			const [row] = suggester.getSuggestions(inputEl.value);
			expect(row?.insert).toBe("{{GLOBAL_VAR:MyProjects}}");
			suggester.selectSuggestion(row);
			expect(inputEl.value).toBe("- {{GLOBAL_VAR:MyProjects}} after");
			expect(inputEl.selectionStart).toBe("- {{GLOBAL_VAR:MyProjects}}".length);

			// The list is rebuilt on a debounce: typing "y" and accepting before
			// the rebuild must still consume the braces after the new caret.
			inputEl.value = "- {{GLOBAL_VAR:M}} after";
			inputEl.setSelectionRange(caret - 1, caret - 1);
			const [beforeY] = suggester.getSuggestions(inputEl.value);
			inputEl.value = "- {{GLOBAL_VAR:My}} after";
			inputEl.setSelectionRange(caret, caret);
			suggester.selectSuggestion(beforeY);
			expect(inputEl.value).toBe("- {{GLOBAL_VAR:MyProjects}} after");

			// Once the caret has left the unfinished fragment, a still-visible row
			// changes nothing: no braces or text between are consumed.
			for (const [value, moveTo] of [
				["- {{GLOBAL_VAR:My}} after", caret + 2],
				["- {{GLOBAL_VAR:My {{DATE}}", "- {{GLOBAL_VAR:My {{DATE".length],
			] as const) {
				inputEl.value = value;
				inputEl.setSelectionRange(caret, caret);
				const [stale] = suggester.getSuggestions(inputEl.value);
				inputEl.setSelectionRange(moveTo, moveTo);
				suggester.selectSuggestion(stale);
				expect(inputEl.value).toBe(value);
			}
		} finally {
			suggester.destroy();
		}
	});
});
