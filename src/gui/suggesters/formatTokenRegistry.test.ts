import { describe, expect, it } from "vitest";
import {
	ensureObsidianDomPolyfills,
	suggestInserts,
	suggestRows,
} from "../../../tests/suggesters/formatSuggesterHarness";
import { FormatSyntaxSuggester } from "./formatSyntaxSuggester";
import type { FormatSuggestContext } from "./formatTokenRegistry";
import { ALL_FORMAT_SUGGEST_CONTEXTS } from "./formatTokenRegistry";

const VAULT = {
	templatePaths: ["Templates/Meeting.md"],
	macroNames: ["My Macro"],
	globalVariables: { Header: "# Log" },
};

/** Every prefix a user can be part-way through, per token family. */
const PREFIXES = [
	"{{",
	"{{v",
	"{{va",
	"{{val",
	"{{value",
	"{{d",
	"{{da",
	"{{dat",
	"{{date",
	"{{f",
	"{{fi",
	"{{fie",
	"{{fil",
	"{{file",
	"{{fo",
	"{{folder",
	"{{l",
	"{{link",
	"{{m",
	"{{mac",
	"{{t",
	"{{te",
	"{{tem",
	"{{ti",
	"{{s",
	"{{c",
	"{{g",
	"{{r",
	"{{VALUE:title|case:",
];

describe("format token autocomplete rows", () => {
	it("gives every row a description, in every context, at every prefix", async () => {
		for (const context of ALL_FORMAT_SUGGEST_CONTEXTS) {
			for (const prefix of PREFIXES) {
				const rows = await suggestRows(prefix, { ...VAULT, context });
				for (const row of rows) {
					expect(
						row.description.trim(),
						`"${row.insert}" at "${prefix}" (${context}) has no description`,
					).not.toBe("");
					// Long enough to spill past two lines stops being a one-liner.
					expect(
						row.description.length,
						`"${row.insert}" description is too long to scan`,
					).toBeLessThanOrEqual(90);
				}
			}
		}
	});

	it("never repeats an insert within one list", async () => {
		for (const context of ALL_FORMAT_SUGGEST_CONTEXTS) {
			for (const prefix of PREFIXES) {
				const inserts = await suggestInserts(prefix, { ...VAULT, context });
				expect(new Set(inserts).size, `duplicate row at "${prefix}"`).toBe(
					inserts.length,
				);
			}
		}
	});

	it("writes every token in the documented casing", async () => {
		for (const context of ALL_FORMAT_SUGGEST_CONTEXTS) {
			for (const insert of await suggestInserts("{{", { ...VAULT, context })) {
				const name = insert.slice(2).replace(/[:|}].*$/s, "");
				expect(name, `"${insert}" is not upper-case`).toBe(name.toUpperCase());
			}
		}
	});

	it("opens with the token that explains what format syntax is for", async () => {
		for (const context of ALL_FORMAT_SUGGEST_CONTEXTS) {
			const inserts = await suggestInserts("{{", { ...VAULT, context });
			// Row 0 is preselected and accepted by Enter, so it is the token a
			// curious "{{" teaches first.
			expect(inserts[0]).toBe("{{VALUE}}");
		}
	});

	it("ranks the token the typed letters start above interior matches", async () => {
		const dates = await suggestInserts("{{dat");
		expect(dates.indexOf("{{DATE}}")).toBeLessThan(dates.indexOf("{{VDATE:}}"));

		const values = await suggestInserts("{{val");
		expect(values.indexOf("{{VALUE}}")).toBeLessThan(
			values.indexOf("{{MVALUE}}"),
		);
	});

	it("keeps the bare {{ list an index, and brings worked examples once asked", async () => {
		const index = await suggestInserts("{{", VAULT);
		expect(index).not.toContain("{{VALUE:title|trim}}");
		expect(index).not.toContain("{{TEMPLATE:Templates/Meeting.md}}");
		expect(index).toContain("{{VALUE:}}");
		expect(index).toContain("{{TEMPLATE:}}");

		const examples = await suggestInserts("{{val", VAULT);
		expect(examples).toContain("{{VALUE:title|trim}}");
		// Every |modifier the docs cover should be reachable as a complete,
		// valid token, so nobody has to hand-type one inside a closed token.
		expect(examples).toContain("{{VALUE:title|case:kebab}}");
		expect(await suggestInserts("{{tem", VAULT)).toContain(
			"{{TEMPLATE:Templates/Meeting.md}}",
		);
		expect(await suggestInserts("{{mac", VAULT)).toContain(
			"{{MACRO:My Macro}}",
		);
		expect(await suggestInserts("{{glo", VAULT)).toContain(
			"{{GLOBAL_VAR:Header}}",
		);
	});

	it("offers the tokens that had no matcher at all before (#1542)", async () => {
		const index = await suggestInserts("{{");
		expect(index).toContain("{{FIELD:}}");
		expect(index).toContain("{{TIME:}}");
		expect(index).toContain("{{FILE:}}");
	});
});

describe("format token autocomplete context gating", () => {
	// The runtime disagreement each of these encodes is why the field context is
	// modelled at all: offering a token a field cannot resolve is a bug.
	const forbidden: Array<[FormatSuggestContext, string, string]> = [
		["captureTarget", "{{TITLE}}", "formatFileName throws on {{title}}"],
		["fileName", "{{TITLE}}", "formatFileName throws on {{title}}"],
		[
			"captureTarget",
			"{{LINKCURRENT}}",
			"formatFileName leaves links literal, naming the file after the token",
		],
		["captureTarget", "{{LINKSECTION}}", "same as {{LINKCURRENT}}"],
		["fileName", "{{LINKCURRENT}}", "same as captureTarget"],
		[
			"lineTarget",
			"{{FOLDERCURRENT}}",
			"formatLocationString leaves it literal in selectors",
		],
	];

	for (const [context, insert, why] of forbidden) {
		it(`does not offer ${insert} in ${context} (${why})`, async () => {
			for (const prefix of PREFIXES) {
				expect(await suggestInserts(prefix, { ...VAULT, context })).not.toContain(
					insert,
				);
			}
		});
	}

	it("keeps {{FOLDERCURRENT}} where it does resolve", async () => {
		expect(await suggestInserts("{{", { context: "captureTarget" })).toContain(
			"{{FOLDERCURRENT}}",
		);
		expect(await suggestInserts("{{", { context: "noteContent" })).toContain(
			"{{FOLDERCURRENT}}",
		);
	});
});

describe("format token insertion", () => {
	async function accept(typed: string, chosen: string) {
		ensureObsidianDomPolyfills();
		const app = {
			dom: { appContainerEl: document.body },
			keymap: { pushScope: () => {}, popScope: () => {} },
		} as any;
		const plugin = {
			settings: { choices: [], globalVariables: {} },
			getTemplateFiles: () => [],
		} as any;

		const inputEl = document.createElement("input");
		inputEl.value = typed;
		inputEl.selectionStart = typed.length;
		inputEl.selectionEnd = typed.length;

		const suggester = new FormatSyntaxSuggester(app, inputEl, plugin);
		try {
			const rows = await suggester.getSuggestions(typed);
			const row = rows.find((candidate) => candidate.insert === chosen);
			expect(row, `"${chosen}" was not offered for "${typed}"`).toBeDefined();
			// biome-ignore lint/style/noNonNullAssertion: asserted above
			suggester.selectSuggestion(row!);
			return {
				value: inputEl.value,
				caret: inputEl.selectionStart ?? inputEl.value.length,
				selection: [
					inputEl.selectionStart ?? inputEl.value.length,
					inputEl.selectionEnd ?? inputEl.value.length,
				] as const,
			};
		} finally {
			suggester.destroy();
		}
	}

	it("parks the caret inside the braces of an empty argument", async () => {
		const { value, caret } = await accept("Note {{dat", "{{DATE:}}");
		expect(value).toBe("Note {{DATE:}}");
		expect(value.slice(0, caret)).toBe("Note {{DATE:");
	});

	it("closes the braces on {{TEMPLATE:}} and {{MACRO:}} instead of stranding the caret mid-word", async () => {
		// These two used to be inserted as the unbalanced "{{TEMPLATE:" while the
		// caret was still moved two characters back, landing at "{{TEMPLAT|E:".
		const template = await accept("Note {{tem", "{{TEMPLATE:}}");
		expect(template.value).toBe("Note {{TEMPLATE:}}");
		expect(template.value.slice(0, template.caret)).toBe("Note {{TEMPLATE:");

		const macro = await accept("Note {{mac", "{{MACRO:}}");
		expect(macro.value).toBe("Note {{MACRO:}}");
		expect(macro.value.slice(0, macro.caret)).toBe("Note {{MACRO:");
	});

	it("leaves the caret after a token that needs no further input", async () => {
		const { value, caret } = await accept("Note {{dat", "{{DATE}}");
		expect(value).toBe("Note {{DATE}}");
		expect(caret).toBe(value.length);
	});

	it("replaces only the token being typed", async () => {
		const { value } = await accept("Log {{sel", "{{SELECTED}}");
		expect(value).toBe("Log {{SELECTED}}");
	});

	it("selects the <placeholder> in an example row so it is typed over", async () => {
		const { value, selection } = await accept("Note {{file", "{{FILE:<folder>}}");
		expect(value).toBe("Note {{FILE:<folder>}}");
		expect(value.slice(selection[0], selection[1])).toBe("<folder>");
	});
});
