import { describe, it, expect } from "vitest";
import { DATE_VARIABLE_REGEX } from "../constants";

// Drives DATE_VARIABLE_REGEX exactly like its consumers do - a fresh global
// regex in an exec loop (formatter.ts replaceDateVariableInString,
// RequirementCollector.ts scanDateTokens, and the two display formatters all
// build `new RegExp(DATE_VARIABLE_REGEX.source, "gi")`).
function scanCount(input: string): number {
	const re = new RegExp(DATE_VARIABLE_REGEX.source, "gi");
	let count = 0;
	while (re.exec(input) !== null) count++;
	return count;
}

function parse(input: string): {
	match: string;
	name: string;
	format: string;
	options: string | null;
} | null {
	const m = new RegExp(DATE_VARIABLE_REGEX.source, "gi").exec(input);
	if (!m) return null;
	return {
		match: m[0],
		name: m[1]?.trim() ?? "",
		format: m[2]?.trim() ?? "",
		options: m[3] ?? null,
	};
}

describe("DATE_VARIABLE_REGEX ReDoS resistance", () => {
	// The old pattern
	//   /{{VDATE:([^\n\r},|]*)(?:,\s*([^\n\r}|]*))?(?:\|([^\n\r}]*))?}}/i
	// had two O(n^2) shapes when scanned with the global flag the consumers use:
	//   - the `,\s*([^\n\r}|]*)` arm overlapped (both halves match space/tab), so
	//     `{{VDATE:a,` + a long whitespace run with no closing `}}` retried every
	//     split of the run;
	//   - the interior classes accepted `{`, so a long run of unterminated
	//     `{{VDATE:` openers made each opener re-scan the tail (FIELD #1455 shape).
	// Both are reachable after untrusted {{CLIPBOARD}}/{{SELECTED}} content is
	// spliced in ahead of the VDATE pass (completeFormatter.ts). The old regex took
	// many seconds at these sizes (~12s at N=50k for the opener flood) and grew
	// quadratically; the fixed regex stays sub-millisecond. A generous budget keeps
	// the test non-flaky while failing hard on any regression.
	const BUDGET_MS = 1000;
	const N = 200_000;

	it(
		"scans a comma + whitespace flood in linear time",
		() => {
			const input = "{{VDATE:a," + " ".repeat(N); // no closing }}
			const start = performance.now();
			expect(scanCount(input)).toBe(0);
			expect(performance.now() - start).toBeLessThan(BUDGET_MS);
		},
		20_000,
	);

	it(
		"scans an unterminated `{{VDATE:` opener flood in linear time",
		() => {
			const input = "{{VDATE:".repeat(N);
			const start = performance.now();
			expect(scanCount(input)).toBe(0);
			expect(performance.now() - start).toBeLessThan(BUDGET_MS);
		},
		20_000,
	);

	it(
		"scans a `{{VDATE:a,` opener flood in linear time",
		() => {
			const input = "{{VDATE:a,".repeat(N);
			const start = performance.now();
			expect(scanCount(input)).toBe(0);
			expect(performance.now() - start).toBeLessThan(BUDGET_MS);
		},
		20_000,
	);
});

describe("DATE_VARIABLE_REGEX parses well-formed tokens unchanged", () => {
	// Locks in that narrowing the interior classes did not change how a normal,
	// single-line VDATE token is captured (name / trimmed format / raw options).
	it.each([
		[
			"{{VDATE:due}}",
			{ match: "{{VDATE:due}}", name: "due", format: "", options: null },
		],
		[
			"{{VDATE:due,YYYY-MM-DD}}",
			{
				match: "{{VDATE:due,YYYY-MM-DD}}",
				name: "due",
				format: "YYYY-MM-DD",
				options: null,
			},
		],
		[
			"{{VDATE:due, YYYY-MM-DD}}", // space after the comma must still trim away
			{
				match: "{{VDATE:due, YYYY-MM-DD}}",
				name: "due",
				format: "YYYY-MM-DD",
				options: null,
			},
		],
		[
			"{{VDATE:event, MMMM Do, YYYY}}", // commas inside the format
			{
				match: "{{VDATE:event, MMMM Do, YYYY}}",
				name: "event",
				format: "MMMM Do, YYYY",
				options: null,
			},
		],
		[
			"{{VDATE:w, [Week] ww}}", // bracket-escaped literal in the format
			{
				match: "{{VDATE:w, [Week] ww}}",
				name: "w",
				format: "[Week] ww",
				options: null,
			},
		],
		[
			"{{VDATE:due, YYYY-MM-DD HH:mm}}",
			{
				match: "{{VDATE:due, YYYY-MM-DD HH:mm}}",
				name: "due",
				format: "YYYY-MM-DD HH:mm",
				options: null,
			},
		],
		[
			"{{VDATE:d, YYYY|tomorrow}}", // |default value
			{
				match: "{{VDATE:d, YYYY|tomorrow}}",
				name: "d",
				format: "YYYY",
				options: "tomorrow",
			},
		],
		[
			"{{VDATE:d, YYYY|optional}}",
			{
				match: "{{VDATE:d, YYYY|optional}}",
				name: "d",
				format: "YYYY",
				options: "optional",
			},
		],
		[
			"{{VDATE:d, YYYY|startof:week}}", // |snap option
			{
				match: "{{VDATE:d, YYYY|startof:week}}",
				name: "d",
				format: "YYYY",
				options: "startof:week",
			},
		],
		[
			"{{VDATE:d, YYYY|next|monday}}", // pipes survive in the options tail
			{
				match: "{{VDATE:d, YYYY|next|monday}}",
				name: "d",
				format: "YYYY",
				options: "next|monday",
			},
		],
		[
			"{{VDATE: spaced , MMMM }}", // surrounding whitespace trims away
			{
				match: "{{VDATE: spaced , MMMM }}",
				name: "spaced",
				format: "MMMM",
				options: null,
			},
		],
	])("parses %s", (input, expected) => {
		expect(parse(input)).toEqual(expected);
	});

	it("resolves the first of multiple tokens, leaving the rest for re-scan", () => {
		expect(parse("a {{VDATE:x, YYYY}} b {{VDATE:y|optional}} c")).toEqual({
			match: "{{VDATE:x, YYYY}}",
			name: "x",
			format: "YYYY",
			options: null,
		});
	});
});

describe("DATE_VARIABLE_REGEX leaves malformed tokens literal", () => {
	// Deliberate, documented consequences of the ReDoS hardening - both only
	// affect inputs that never carried a meaningful VDATE value.
	it("does not match a token that spans a newline after the comma", () => {
		// group 1 / group 3 already excluded \n\r; this removes the lone artifact
		// where the dropped `\s*` let a token straddle a line break.
		expect(parse("{{VDATE:a,\nMMMM}}")).toBeNull();
	});

	it("does not consume across a nested `{` (unsupported nested token)", () => {
		// The old regex grabbed `{{VALUE:x` as the variable name; now the opener
		// is left literal so the inner token can resolve on its own pass.
		expect(parse("{{VDATE:{{VALUE:x}}, YYYY}}")).toBeNull();
	});
});
