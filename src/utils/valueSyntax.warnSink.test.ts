import { describe, expect, it, vi } from "vitest";
import { log } from "../logger/logManager";
import { parseAnonymousValueOptions, parseValueToken } from "./valueSyntax";
import { SILENT_WARN } from "./warnSink";

/**
 * Issue #1558. `parseAnonymousValueOptions` accepted a `quiet` flag, honoured it
 * for the `|case:` warning, and then forwarded nothing to `resolveInputType` and
 * a hardcoded `false` to `resolveNumericInput`. So the deliberately-silent
 * prompt-context pre-pass in `Formatter.getValuePromptContext` warned anyway,
 * and every anonymous `{{VALUE|type:...}}` typo produced TWO Notices per parse.
 *
 * The sink is now a required parameter on those helpers, so the omission cannot
 * come back silently. These tests pin the observable contract.
 */
describe("valueSyntax warn sink", () => {
	function captureWarnings(run: () => void): string[] {
		const seen: string[] = [];
		const spy = vi
			.spyOn(log, "logWarning")
			.mockImplementation((m: string) => void seen.push(m));
		try {
			run();
		} finally {
			spy.mockRestore();
		}
		return seen;
	}

	it("routes |type:, |min:/|max:/|step: and slider warnings through the sink (anonymous form)", () => {
		const cases = [
			"|type:numbr",
			"|type:number|min:x",
			"|type:number|max:x",
			"|type:number|step:0",
			"|type:number|min:5|max:1",
			"|type:slider|min:1",
		];

		for (const rawOptions of cases) {
			const silent: string[] = [];
			expect(
				captureWarnings(() =>
					parseAnonymousValueOptions(rawOptions, {
						warn: (m) => void silent.push(m),
					}),
				),
				`{{VALUE${rawOptions}}} must not reach the default Notice sink`,
			).toEqual([]);
			expect(
				silent.length,
				`{{VALUE${rawOptions}}} should warn through the caller's sink`,
			).toBeGreaterThan(0);
		}
	});

	it("stays completely silent on the anonymous form with SILENT_WARN", () => {
		const warnings = captureWarnings(() => {
			parseAnonymousValueOptions("|type:numbr", { warn: SILENT_WARN });
			parseAnonymousValueOptions("|type:slider|min:1", { warn: SILENT_WARN });
			parseAnonymousValueOptions("|case:pasc", { warn: SILENT_WARN });
			parseAnonymousValueOptions("|min:1|max:3", { warn: SILENT_WARN });
		});
		expect(warnings).toEqual([]);
	});

	it("warns exactly once per anonymous |type: typo when the sink is the default", () => {
		const warnings = captureWarnings(() =>
			parseAnonymousValueOptions("|type:numbr"),
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('Unsupported VALUE type "numbr"');
	});

	it("keeps the named form's sink wiring intact", () => {
		const collected: string[] = [];
		const warnings = captureWarnings(() =>
			parseValueToken("x|type:numbr|min:q", {
				warn: (m) => void collected.push(m),
			}),
		);
		expect(warnings).toEqual([]);
		expect(collected.some((m) => m.includes("Unsupported VALUE type"))).toBe(
			true,
		);
	});

	it("names the token in the empty |name: warning", () => {
		const collected: string[] = [];
		parseValueToken("a,b|name:", { warn: (m) => void collected.push(m) });
		expect(collected).toHaveLength(1);
		expect(collected[0]).toContain("{{VALUE:a,b|name:}}");
	});
});
