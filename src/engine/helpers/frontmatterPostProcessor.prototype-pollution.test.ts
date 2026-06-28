import { describe, it, expect, afterEach } from "vitest";
import {
	assignFrontmatterValue,
	hasUnsafeFrontmatterKey,
} from "./frontmatterPostProcessor";
import { TemplatePropertyCollector } from "../../utils/TemplatePropertyCollector";

/**
 * Regression coverage for the prototype-pollution guard in
 * {@link assignFrontmatterValue}.
 *
 * Front-matter key paths originate from template/note content that can be
 * authored elsewhere (synced/shared data.json, imported community packages).
 * A crafted nested key such as `__proto__` must never be followed while walking
 * the path - doing so would mutate global JS prototype state for the entire
 * Electron renderer (Obsidian core + every other plugin), not the file's own
 * front matter.
 */
describe("assignFrontmatterValue - prototype pollution guard", () => {
	afterEach(() => {
		// Defensive cleanup so a regression here cannot leak into other tests.
		delete (Object.prototype as Record<string, unknown>).polluted;
		delete (Object.prototype as Record<string, unknown>).polluted2;
	});

	it("refuses a __proto__ path and does not pollute Object.prototype", () => {
		const frontmatter: Record<string, unknown> = {};

		// Without the guard this walks into Object.prototype and sets it globally.
		assignFrontmatterValue(frontmatter, ["__proto__", "polluted"], "PWNED");

		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		// The whole assignment is refused, so nothing is written to the target.
		expect(Object.keys(frontmatter)).toHaveLength(0);
	});

	it("refuses a __proto__ segment anywhere in the path", () => {
		const frontmatter: Record<string, unknown> = {};

		assignFrontmatterValue(
			frontmatter,
			["safe", "__proto__", "polluted"],
			"PWNED",
		);

		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(Object.keys(frontmatter)).toHaveLength(0);
	});

	it("refuses descent through a constructor/prototype segment (gadget defense in depth)", () => {
		const frontmatter: Record<string, unknown> = {};

		assignFrontmatterValue(
			frontmatter,
			["constructor", "prototype", "polluted2"],
			"PWNED",
		);

		expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
		// Refused outright - no stray `constructor` own key written either.
		expect(
			Object.prototype.hasOwnProperty.call(frontmatter, "constructor"),
		).toBe(false);
		expect(Object.keys(frontmatter)).toHaveLength(0);
	});

	it("still nests safe multi-segment paths (minimality lock)", () => {
		const frontmatter: Record<string, unknown> = {};

		assignFrontmatterValue(frontmatter, ["a", "b", "c"], 1);
		assignFrontmatterValue(frontmatter, ["top"], 2);

		expect(frontmatter).toEqual({ a: { b: { c: 1 } }, top: 2 });
	});

	it("preserves legitimate terminal constructor/prototype keys (no collateral)", () => {
		const frontmatter: Record<string, unknown> = {};

		// As a leaf, these are normal own-property writes - valid front-matter
		// metadata names (e.g. a programming or design note). They must be kept.
		assignFrontmatterValue(frontmatter, ["constructor"], "Class notes");
		assignFrontmatterValue(frontmatter, ["prototype"], "Board A");
		assignFrontmatterValue(frontmatter, ["spec", "prototype"], 2);

		expect(
			Object.prototype.hasOwnProperty.call(frontmatter, "constructor"),
		).toBe(true);
		expect(frontmatter.constructor).toBe("Class notes");
		expect(frontmatter.prototype).toBe("Board A");
		expect((frontmatter.spec as Record<string, unknown>).prototype).toBe(2);
		// None of these touch the global prototype.
		expect(({} as Record<string, unknown>).constructor).toBe(Object);
	});
});

/**
 * End-to-end reachability: prove that a crafted YAML template (the kind that
 * can arrive via a synced/shared data.json or an imported community package)
 * actually drives the real {@link TemplatePropertyCollector} to emit a
 * `__proto__`-rooted key path, and that the guard in {@link assignFrontmatterValue}
 * neutralizes it. This exercises the full collector -> post-processor chain with
 * no JavaScript in the payload, only the opt-in comma-list heuristic.
 */
describe("prototype pollution - collector reachability", () => {
	afterEach(() => {
		delete (Object.prototype as Record<string, unknown>).polluted;
	});

	/** Mirrors how Formatter.replaceVariableInString calls maybeCollect. */
	function collectFromTemplate(
		input: string,
		token: string,
		rawValue: unknown,
	): Map<string, unknown> {
		const collector = new TemplatePropertyCollector();
		const matchStart = input.indexOf(token);
		const matchEnd = matchStart + token.length;
		collector.maybeCollect({
			input,
			matchStart,
			matchEnd,
			rawValue,
			fallbackKey: "item",
			collectionActive: true,
			heuristicEnabled: true,
		});
		return collector.drain();
	}

	const MALICIOUS_TEMPLATE = [
		"---",
		"__proto__:",
		"  polluted:",
		"    - {{VALUE:item}}",
		"---",
		"body",
	].join("\n");

	it("collector derives the __proto__-rooted path from the template", () => {
		// The comma-list heuristic turns "a,b" into an array, which the collector
		// gathers under the path walked up from the list item: ['__proto__','polluted'].
		const vars = collectFromTemplate(MALICIOUS_TEMPLATE, "{{VALUE:item}}", "a,b");

		const dangerousKey = ["__proto__", "polluted"].join(
			TemplatePropertyCollector.PATH_SEPARATOR,
		);
		expect(vars.has(dangerousKey)).toBe(true);
		expect(vars.get(dangerousKey)).toEqual(["a", "b"]);
	});

	it("guard neutralizes the derived path during front matter assignment", () => {
		const vars = collectFromTemplate(MALICIOUS_TEMPLATE, "{{VALUE:item}}", "a,b");
		const frontmatter: Record<string, unknown> = {};

		// Replays postProcessFrontMatter's split-and-assign over the collected vars.
		for (const [key, value] of vars) {
			const segments = key.includes(TemplatePropertyCollector.PATH_SEPARATOR)
				? key.split(TemplatePropertyCollector.PATH_SEPARATOR)
				: [key];
			assignFrontmatterValue(frontmatter, segments, value);
		}

		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(Object.keys(frontmatter)).toHaveLength(0);
	});
});

describe("hasUnsafeFrontmatterKey", () => {
	it("flags __proto__ at any position", () => {
		expect(hasUnsafeFrontmatterKey(["__proto__"])).toBe(true);
		expect(hasUnsafeFrontmatterKey(["__proto__", "x"])).toBe(true);
		expect(hasUnsafeFrontmatterKey(["safe", "__proto__", "x"])).toBe(true);
		expect(hasUnsafeFrontmatterKey(["a", "b", "__proto__"])).toBe(true);
	});

	it("flags constructor/prototype only as a non-terminal descent segment", () => {
		// Descending THROUGH these is the classic constructor.prototype gadget.
		expect(hasUnsafeFrontmatterKey(["constructor", "x"])).toBe(true);
		expect(hasUnsafeFrontmatterKey(["prototype", "x"])).toBe(true);
		expect(hasUnsafeFrontmatterKey(["a", "constructor", "b"])).toBe(true);
	});

	it("permits constructor/prototype as a legitimate terminal key (no collateral)", () => {
		// As a leaf key these are harmless own-property writes and valid metadata
		// names (e.g. a programming/design note). They must NOT be dropped.
		expect(hasUnsafeFrontmatterKey(["constructor"])).toBe(false);
		expect(hasUnsafeFrontmatterKey(["prototype"])).toBe(false);
		expect(hasUnsafeFrontmatterKey(["spec", "prototype"])).toBe(false);
		expect(hasUnsafeFrontmatterKey(["class", "constructor"])).toBe(false);
	});

	it("does not flag safe keys or whitespace-padded near-matches", () => {
		// Collected segments are always trimmed upstream, and only the exact
		// string "__proto__" trips the JS prototype setter, so a padded variant
		// is inert and must not be treated as unsafe.
		expect(hasUnsafeFrontmatterKey([" __proto__ ", "x"])).toBe(false);
		expect(hasUnsafeFrontmatterKey(["a", "b"])).toBe(false);
		expect(hasUnsafeFrontmatterKey(["proto"])).toBe(false);
		expect(hasUnsafeFrontmatterKey([])).toBe(false);
	});
});
