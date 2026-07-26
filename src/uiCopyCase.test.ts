import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The settings tab transitively imports the real obsidian-dataview, which cannot
// resolve `obsidian` outside the app (same stub as every other tab test).
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { QuickAddSettingsTab } from "./quickAddSettingsTab";
import { DEFAULT_SETTINGS } from "./settings";
import { settingsStore } from "./settingsStore";
import { deepClone } from "./utils/deepClone";
import type QuickAdd from "./main";

/**
 * Copy-style regression guard for #1553.
 *
 * Obsidian writes its UI in sentence case throughout — "Files and links",
 * "Community plugins", "Date & time" — and QuickAdd had drifted into Title Case
 * one setting at a time over several years. Converting ~40 strings once fixes
 * today; it does nothing about tomorrow, because nothing in the build had an
 * opinion about casing, so every new `setName("Some New Thing")` re-opened the
 * issue. That is what this file is for.
 *
 * Two checks, deliberately different in kind:
 *  1. The settings tab's own definitions, read from `getSettingDefinitions()` —
 *     the exact surface #1553 was filed about.
 *  2. A source scan over every UI-label literal in `src/`, because the drift did
 *     not stop at the settings tab: it reached the choice builder, the macro
 *     command modals, the AI assistant modals and the package manager, all of
 *     which open FROM that tab.
 *
 * The scan is intentionally literal-only. A label built from a variable or a
 * template string cannot be judged here, so those are skipped rather than
 * guessed at — the sampling sliders' `.setName(spec.name)` is the known example,
 * and it is covered by the definitions check on its own data instead.
 *
 * If this test fails on a string you are adding: write it in sentence case. If
 * the capital belongs to a real proper noun, add that word to PROPER_NOUNS.
 */

const SRC = resolve(__dirname);
const EXTS = [".ts", ".svelte"];

/**
 * Words that may keep a capital mid-sentence: real proper nouns, Obsidian's own
 * feature names, and QuickAdd's choice TYPE names, which the UI uses as nouns
 * ("a Capture choice", "the Template path").
 *
 * `Multi` is deliberately absent. It is the internal type id for what the UI
 * calls a folder (see src/utils/choiceNoun.ts), so it must never reach a label.
 */
const PROPER_NOUNS = new Set([
	"AI",
	"Anthropic",
	"Assistant",
	"Beta",
	"Capture",
	"Checkbox",
	"Cmd",
	"Ctrl",
	"Enter",
	"Gemini",
	"List",
	"Macro",
	"Number",
	"Obsidian",
	"OpenAI",
	"Preview",
	"QuickAdd",
	"SecretStorage",
	"Source",
	"Template",
	"Templater",
	"URI",
	"URL",
]);

/** Capitalized words in `text` that are neither sentence-initial nor proper nouns. */
export function titleCaseWords(text: string): string[] {
	const words = text.split(/\s+/);
	return words.filter((raw, i) => {
		const previous = words[i - 1] ?? "";
		// A word that opens a quote or bracket, or follows terminal punctuation,
		// starts a sentence — its capital is correct.
		const startsSentence =
			i === 0 || /^[“"'([]/.test(raw) || /[.:?!]["”]?$/.test(previous);
		const word = raw.replace(/^[^\p{L}]+/u, "").replace(/[^\p{L}]+$/u, "");
		if (!word || startsSentence) return false;
		return /^\p{Lu}/u.test(word) && !PROPER_NOUNS.has(word);
	});
}

describe("settings tab copy", () => {
	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	/**
	 * Every heading and label the tab declares, including the Developer group.
	 * `getSettingDefinitions()` gates that group behind `__IS_DEV_BUILD__`, which
	 * vitest pins to false, so reaching for the builder directly is what keeps
	 * its strings covered rather than silently exempt.
	 */
	function definitionStrings(): { headings: string[]; names: string[]; descs: string[] } {
		const app = new App();
		const tab = new QuickAddSettingsTab(app, { app } as unknown as QuickAdd);
		type Group = {
			heading?: string;
			items?: Array<{ name?: string; desc?: string | DocumentFragment }>;
		};
		const groups = [
			...(tab.getSettingDefinitions() as unknown as Group[]),
			(tab as unknown as { developerGroup(): Group }).developerGroup(),
		];

		return {
			headings: groups.flatMap((g) => (g.heading ? [g.heading] : [])),
			names: groups.flatMap((g) =>
				(g.items ?? []).flatMap((i) => (i.name ? [i.name] : [])),
			),
			descs: groups.flatMap((g) =>
				(g.items ?? []).flatMap((i) =>
					typeof i.desc === "string" ? [i.desc] : [],
				),
			),
		};
	}

	it("covers the Developer group, which __IS_DEV_BUILD__ hides from the tab", () => {
		expect(definitionStrings().headings).toContain("Developer");
	});

	it("writes every heading and label in sentence case", () => {
		const { headings, names } = definitionStrings();
		const offenders = [...headings, ...names]
			.map((text) => [text, titleCaseWords(text)] as const)
			.filter(([, bad]) => bad.length > 0);

		expect(offenders).toEqual([]);
	});

	it("never shows the user the internal 'Multi' type name", () => {
		const { headings, names, descs } = definitionStrings();
		const offenders = [...headings, ...names, ...descs].filter((text) =>
			/\bMulti\b/.test(text),
		);

		expect(offenders).toEqual([]);
	});
});

describe("UI label copy across src/", () => {
	/**
	 * Label literals, by how they reach the screen. Each pattern's first capture
	 * group is the string. Non-literal labels (`${...}`, a variable, a member
	 * expression) simply do not match, which is the intent — see the file header.
	 */
	const PATTERNS: RegExp[] = [
		/\.set(?:Name|Title|ButtonText|Tooltip)\(\s*"([^"$]+)"\s*[,)]/g,
		/\.(?:titleEl|headerEl)\.setText\(\s*"([^"$]+)"\s*\)/g,
		/\.(?:titleEl|headerEl)\.textContent\s*=\s*"([^"$]+)"/g,
		/createEl\(\s*"h[1-6]"\s*,\s*\{\s*text:\s*"([^"$]+)"/g,
		/<h[1-6]>([^<{]+)<\/h[1-6]>/g,
		/\bname="([^"{]+)"/g,
		// Svelte buttons with a literal label — GlobalVariablesView's "Add variable"
		// and the package-manager actions never touch a Setting or setButtonText.
		/<button\b[^>]*>\s*([^<>{]+?)\s*<\/button>/g,
	];

	function walk(dir: string, acc: string[] = []): string[] {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path, acc);
			else if (
				EXTS.includes(extname(entry.name)) &&
				!/\.(test|spec)\./.test(entry.name) &&
				!entry.name.endsWith(".d.ts")
			) {
				acc.push(path);
			}
		}
		return acc;
	}

	const labels = walk(SRC).flatMap((file) => {
		const source = readFileSync(file, "utf8");
		return PATTERNS.flatMap((pattern) =>
			[...source.matchAll(pattern)].map((match) => ({
				file: relative(SRC, file),
				text: match[1].trim(),
			})),
		);
	});

	it("finds labels to check (the scan itself must not silently go blind)", () => {
		expect(labels.length).toBeGreaterThan(100);
	});

	it("writes every UI label in sentence case", () => {
		const offenders = labels
			.map((label) => ({ ...label, bad: titleCaseWords(label.text) }))
			.filter((label) => label.bad.length > 0)
			.map((label) => `${label.file}: "${label.text}" (${label.bad.join(", ")})`);

		expect(offenders).toEqual([]);
	});
});
